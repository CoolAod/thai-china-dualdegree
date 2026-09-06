/**
 * =====================================================================
 *  ระบบข้อมูลนักเรียนทวิวุฒิ ไทย–จีน — Backend (Google Apps Script)
 *  วิทยาลัยเทคนิคประจวบคีรีขันธ์
 * =====================================================================
 *  วิธีติดตั้ง:
 *  1. สร้าง Google Sheet 1 ไฟล์ แล้วสร้างชีตย่อยตามชื่อใน SHEETS ด้านล่าง
 *     พร้อมหัวตาราง (แถวที่ 1) ตามฟิลด์ที่ระบบใช้งาน (ดูตัวอย่างใน FIELD MAP)
 *  2. เปิด Extensions > Apps Script แล้ววางไฟล์นี้ทับ Code.gs
 *  3. ไปที่ Deploy > New deployment > เลือกประเภท "Web app"
 *     - Execute as: Me
 *     - Who has access: Anyone (หรือ Anyone with Google account ตามนโยบายวิทยาลัย)
 *  4. คัดลอก Web App URL ที่ได้ ไปแทนที่ API_URL ในไฟล์ login.html,
 *     student-form.html, student-profile.html, dashboard.html
 *  5. สร้างผู้ใช้แอดมินอย่างน้อย 1 คนในชีต "Users" (รหัสผ่านจะถูกแฮชอัตโนมัติ
 *     เมื่อเรียก setupFirstAdmin() หนึ่งครั้งจาก Apps Script editor — ดูด้านล่างสุด)
 * =====================================================================
 */

// ---------------------------------------------------------------------
// CONFIG
// ---------------------------------------------------------------------
const SHEETS = {
  STUDENTS: 'Students',
  USERS: 'Users',
  MASTER: 'MasterData',
  EDIT_LOG: 'EditLog',
  SESSIONS: 'Sessions',
  PASSWORD_RESETS: 'PasswordResets'
};

// อายุของ session token (ชั่วโมง)
const SESSION_TTL_HOURS = 8;

// ใส่ Folder ID ของ Google Drive ที่จะใช้เก็บรูปนักเรียน (เปิดโฟลเดอร์ใน Drive แล้วคัดลอก ID จาก URL)
const PHOTO_FOLDER_ID = '1E5xIaAuxV_ZkVGVqkrR_VztiahlahZQW';

// URL ของหน้า reset-password.html หลัง deploy ขึ้นจริงแล้ว (ใช้แนบลิงก์ในอีเมลลืมรหัสผ่าน)
const RESET_PASSWORD_PAGE_URL = 'https://thaichina.pkc.ac.th/reset-password.html';

// คอลัมน์ของชีต Students (แถวหัวตาราง แถวที่ 1 ต้องตรงตามนี้ทุกตัวอักษร)
const STUDENT_FIELDS = [
  'id', 'studentCode', 'nationalId', 'prefix', 'firstName', 'lastName', 'englishName',
  'gender', 'birthDate', 'phone', 'email', 'address', 'photoUrl',
  'eduYear', 'eduLevel', 'learnerType', 'department', 'major', 'classroom',
  'cohort', 'learnGroup', 'admissionDate', 'eduStatus',
  'thSchool', 'thDept', 'thMajor', 'thLevel', 'thStartDate', 'thEndDate', 'thYear', 'thQualification',
  'cnCountry', 'cnProvince', 'cnFormat', 'cnSchoolEn', 'cnSchoolZh', 'cnFaculty',
  'cnMajorEn', 'cnMajorZh', 'cnStartDate', 'cnEndDate', 'cnProgramCode', 'cnQualification', 'cnCurriculumNames',
  'createdAt', 'updatedAt'
];

// ---------------------------------------------------------------------
// ENTRY POINTS: doGet / doPost
// ---------------------------------------------------------------------

/**
 * GET ใช้สำหรับดึงข้อมูล (read-only): getStudents, getStudent, getDashboardStats, getMasterData
 * ตัวอย่าง: {API_URL}?action=getStudents&year=2569&department=การโรงแรม
 */
function doGet(e) {
  try {
    const params = (e && e.parameter) ? e.parameter : {};
    const action = params.action || '';

    switch (action) {
      case 'getStudents':
        return jsonResponse({ success: true, data: getStudents_(params) });
      case 'getStudent':
        return jsonResponse(getStudent_(params.id, params.token));
      case 'getDashboardStats':
        return jsonResponse({ success: true, data: getDashboardStats_(params) });
      case 'getMasterData':
        return jsonResponse({ success: true, data: getMasterData_() });
      case 'checkStudentCode':
        return jsonResponse(checkStudentCode_(params.studentCode));
      case 'ping':
        return jsonResponse({ success: true, message: 'pong' });
      default:
        return jsonResponse({ success: false, message: 'ไม่พบ action ที่ร้องขอ: ' + action });
    }
  } catch (err) {
    return jsonResponse({ success: false, message: 'เกิดข้อผิดพลาดของเซิร์ฟเวอร์: ' + safeErr_(err) });
  }
}

/**
 * POST ใช้สำหรับ: login, saveStudent (เพิ่ม/แก้ไข), deleteStudent, uploadPhoto,
 * saveMasterItem, deleteMasterItem, changePassword, requestPasswordReset, resetPassword, logout
 * ต้องส่ง body เป็น JSON string, Content-Type: text/plain (เพื่อเลี่ยง CORS preflight)
 */
function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return jsonResponse({ success: false, message: 'ไม่พบข้อมูลที่ส่งมา (empty request body)' });
    }
    const body = JSON.parse(e.postData.contents);
    const action = body.action || '';

    switch (action) {
      case 'login':
        return jsonResponse(login_(body.username, body.password));
      case 'saveStudent':
        return jsonResponse(requireAuth_(body, () => saveStudent_(body)));
      case 'deleteStudent':
        return jsonResponse(requireAuth_(body, () => deleteStudent_(body.id)));
      case 'saveMasterItem':
        return jsonResponse(requireAuth_(body, () => saveMasterItem_(body)));
      case 'deleteMasterItem':
        return jsonResponse(requireAuth_(body, () => deleteMasterItem_(body.id)));
      case 'uploadPhoto':
        return jsonResponse(requireAuth_(body, () => uploadPhoto_(body)));
      case 'changePassword':
        return jsonResponse(changePassword_(body));
      case 'requestPasswordReset':
        return jsonResponse(requestPasswordReset_(body.usernameOrEmail));
      case 'resetPassword':
        return jsonResponse(resetPassword_(body.token, body.newPassword));
      case 'logout':
        return jsonResponse(logout_(body.token));
      default:
        return jsonResponse({ success: false, message: 'ไม่พบ action ที่ร้องขอ: ' + action });
    }
  } catch (err) {
    return jsonResponse({ success: false, message: 'เกิดข้อผิดพลาดของเซิร์ฟเวอร์: ' + safeErr_(err) });
  }
}

// ---------------------------------------------------------------------
// AUTH
// ---------------------------------------------------------------------

function login_(username, password) {
  if (!username || !password) {
    return { success: false, message: 'กรุณากรอกชื่อผู้ใช้และรหัสผ่าน' };
  }
  const sheet = getSheet_(SHEETS.USERS);
  if (!sheet) return { success: false, message: 'ไม่พบข้อมูลผู้ใช้งานในระบบ (Users sheet)' };

  const rows = sheetToObjects_(sheet);
  const user = rows.find(r => String(r.username).toLowerCase() === String(username).toLowerCase());

  if (!user) return { success: false, message: 'ไม่พบชื่อผู้ใช้นี้ในระบบ' };
  if (String(user.active).toUpperCase() === 'FALSE') {
    return { success: false, message: 'บัญชีนี้ถูกระงับการใช้งาน กรุณาติดต่อผู้ดูแลระบบ' };
  }

  const hashed = hashPassword_(password, user.salt || '');
  if (hashed !== user.passwordHash) {
    return { success: false, message: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' };
  }

  const token = createSession_(user.username, user.displayName || user.username, user.role || 'admin');
  return { success: true, token: token, displayName: user.displayName || user.username, role: user.role || 'admin' };
}

function createSession_(username, displayName, role) {
  const sheet = getOrCreateSheet_(SHEETS.SESSIONS, ['token', 'username', 'displayName', 'role', 'expiresAt']);
  const token = Utilities.getUuid();
  const expiresAt = new Date(Date.now() + SESSION_TTL_HOURS * 3600 * 1000).toISOString();
  sheet.appendRow([token, username, displayName, role, expiresAt]);
  return token;
}

function logout_(token) {
  if (!token) return { success: true };
  const sheet = getSheet_(SHEETS.SESSIONS);
  if (!sheet) return { success: true };
  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === token) {
      sheet.deleteRow(i + 1);
      break;
    }
  }
  return { success: true };
}

/** ตรวจสอบ token ก่อนอนุญาตให้ทำรายการที่ต้องมีสิทธิ์ผู้ดูแล (เพิ่ม/แก้ไข/ลบ) */
function isValidSession_(token) {
  if (!token) return false;
  const sheet = getSheet_(SHEETS.SESSIONS);
  if (!sheet) return false;
  const rows = sheetToObjects_(sheet);
  const session = rows.find(r => r.token === token);
  if (!session) return false;
  return new Date(session.expiresAt).getTime() > Date.now();
}

/** เหมือน isValidSession_ แต่คืนข้อมูล session (username) กลับมาด้วย ใช้ตอนเปลี่ยนรหัสผ่าน */
function getSessionUser_(token) {
  if (!token) return null;
  const sheet = getSheet_(SHEETS.SESSIONS);
  if (!sheet) return null;
  const rows = sheetToObjects_(sheet);
  const session = rows.find(r => r.token === token);
  if (!session) return null;
  if (new Date(session.expiresAt).getTime() < Date.now()) return null;
  return session;
}

/** wrapper: ปฏิเสธคำขอถ้าไม่มี token ที่ถูกต้อง — ป้องกันการแก้ไขข้อมูลโดยไม่ผ่านการล็อกอิน */
function requireAuth_(body, fn) {
  if (!isValidSession_(body.token)) {
    return { success: false, message: 'กรุณาเข้าสู่ระบบก่อนทำรายการนี้ (session หมดอายุหรือไม่ถูกต้อง)' };
  }
  return fn();
}

function hashPassword_(password, salt) {
  const raw = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    password + '|' + salt,
    Utilities.Charset.UTF_8
  );
  return raw.map(b => (b < 0 ? b + 256 : b).toString(16).padStart(2, '0')).join('');
}

/**
 * เรียกฟังก์ชันนี้ครั้งเดียวจาก Apps Script editor (เลือกฟังก์ชันนี้แล้วกด Run)
 * เพื่อสร้างผู้ใช้แอดมินคนแรก — แล้วลบ/คอมเมนต์โค้ดนี้ทิ้งเพื่อความปลอดภัย
 */
function setupFirstAdmin() {
  const sheet = getOrCreateSheet_(SHEETS.USERS, ['username', 'displayName', 'email', 'role', 'salt', 'passwordHash', 'active']);
  const salt = Utilities.getUuid();
  const passwordHash = hashPassword_('ChangeMe123!', salt); // TODO: เปลี่ยนรหัสผ่านตั้งต้นทันทีหลังติดตั้ง
  sheet.appendRow(['admin', 'ผู้ดูแลระบบ', 'admin@example.com', 'admin', salt, passwordHash, true]); // TODO: แก้อีเมลเป็นอีเมลจริงเพื่อให้ใช้ "ลืมรหัสผ่าน" ได้
  Logger.log('สร้างผู้ใช้แอดมิน "admin" รหัสผ่านเริ่มต้น "ChangeMe123!" เรียบร้อยแล้ว — กรุณาเปลี่ยนรหัสผ่านและอีเมลทันที');
}

// ---------------------------------------------------------------------
// PASSWORD: เปลี่ยนรหัสผ่าน / ลืมรหัสผ่าน
// ---------------------------------------------------------------------

/** เปลี่ยนรหัสผ่าน (ต้องล็อกอินอยู่แล้ว ใช้ตอนรู้รหัสผ่านเดิม) */
function changePassword_(body) {
  const session = getSessionUser_(body.token);
  if (!session) return { success: false, message: 'session หมดอายุ กรุณาเข้าสู่ระบบใหม่ก่อนเปลี่ยนรหัสผ่าน' };
  if (!body.oldPassword || !body.newPassword) return { success: false, message: 'กรุณากรอกรหัสผ่านเดิมและรหัสผ่านใหม่ให้ครบถ้วน' };
  if (String(body.newPassword).length < 8) return { success: false, message: 'รหัสผ่านใหม่ต้องมีอย่างน้อย 8 ตัวอักษร' };

  const sheet = getSheet_(SHEETS.USERS);
  if (!sheet) return { success: false, message: 'ไม่พบข้อมูลผู้ใช้งานในระบบ' };
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const userCol = headers.indexOf('username');

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][userCol]) === String(session.username)) {
      const currentSalt = data[i][headers.indexOf('salt')];
      const currentHash = data[i][headers.indexOf('passwordHash')];
      if (hashPassword_(body.oldPassword, currentSalt) !== currentHash) {
        return { success: false, message: 'รหัสผ่านเดิมไม่ถูกต้อง' };
      }
      const newSalt = Utilities.getUuid();
      const newHash = hashPassword_(body.newPassword, newSalt);
      sheet.getRange(i + 1, headers.indexOf('salt') + 1).setValue(newSalt);
      sheet.getRange(i + 1, headers.indexOf('passwordHash') + 1).setValue(newHash);
      return { success: true, message: 'เปลี่ยนรหัสผ่านเรียบร้อยแล้ว' };
    }
  }
  return { success: false, message: 'ไม่พบบัญชีผู้ใช้งานที่เกี่ยวข้อง' };
}

/** ร้องขอรีเซ็ตรหัสผ่าน — ส่งลิงก์ไปยังอีเมลที่ลงทะเบียนไว้ในชีต Users (ต้องมีคอลัมน์ email) */
function requestPasswordReset_(usernameOrEmail) {
  // ข้อความตอบกลับแบบเดียวเสมอ ไม่บอกว่าพบบัญชีหรือไม่ เพื่อป้องกันคนแอบสุ่มหาชื่อผู้ใช้ที่มีอยู่จริง (user enumeration)
  const genericMsg = 'หากมีบัญชีนี้อยู่ในระบบ เราได้ส่งลิงก์สำหรับตั้งรหัสผ่านใหม่ไปยังอีเมลที่ลงทะเบียนไว้แล้ว กรุณาตรวจสอบกล่องข้อความ (รวมถึง Junk/Spam)';
  if (!usernameOrEmail) return { success: false, message: 'กรุณาระบุชื่อผู้ใช้หรืออีเมล' };

  const sheet = getSheet_(SHEETS.USERS);
  if (!sheet) return { success: true, message: genericMsg };
  const users = sheetToObjects_(sheet);
  const user = users.find(u =>
    String(u.username).toLowerCase() === String(usernameOrEmail).toLowerCase() ||
    (u.email && String(u.email).toLowerCase() === String(usernameOrEmail).toLowerCase())
  );
  if (!user || !user.email) return { success: true, message: genericMsg };

  try {
    const resetSheet = getOrCreateSheet_(SHEETS.PASSWORD_RESETS, ['token', 'username', 'expiresAt']);
    const token = Utilities.getUuid();
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString(); // ลิงก์อายุ 30 นาที
    resetSheet.appendRow([token, user.username, expiresAt]);

    const resetUrl = RESET_PASSWORD_PAGE_URL + '?token=' + token;
    MailApp.sendEmail(
      user.email,
      'ตั้งรหัสผ่านใหม่ — ระบบข้อมูลนักเรียนทวิวุฒิ ไทย–จีน',
      'เรียนคุณ ' + (user.displayName || user.username) + '\n\n' +
      'มีการร้องขอตั้งรหัสผ่านใหม่สำหรับบัญชีผู้ใช้ "' + user.username + '"\n' +
      'คลิกลิงก์ด้านล่างเพื่อตั้งรหัสผ่านใหม่ (ลิงก์มีอายุ 30 นาที):\n' + resetUrl + '\n\n' +
      'หากคุณไม่ได้เป็นผู้ร้องขอ กรุณาเพิกเฉยต่ออีเมลฉบับนี้ได้เลย รหัสผ่านเดิมของคุณจะไม่ถูกเปลี่ยนแปลง'
    );
  } catch (err) {
    Logger.log('ส่งอีเมลรีเซ็ตรหัสผ่านไม่สำเร็จ: ' + safeErr_(err));
  }
  return { success: true, message: genericMsg };
}

/** ตั้งรหัสผ่านใหม่จากลิงก์ที่ได้รับทางอีเมล */
function resetPassword_(token, newPassword) {
  if (!token || !newPassword) return { success: false, message: 'ข้อมูลไม่ครบถ้วน' };
  if (String(newPassword).length < 8) return { success: false, message: 'รหัสผ่านใหม่ต้องมีอย่างน้อย 8 ตัวอักษร' };

  const resetSheet = getSheet_(SHEETS.PASSWORD_RESETS);
  if (!resetSheet) return { success: false, message: 'ลิงก์นี้หมดอายุหรือไม่ถูกต้อง' };
  const rows = resetSheet.getDataRange().getValues();
  const headers = rows[0];
  const tokenCol = headers.indexOf('token');
  const userCol = headers.indexOf('username');
  const expCol = headers.indexOf('expiresAt');

  for (let i = 1; i < rows.length; i++) {
    if (rows[i][tokenCol] === token) {
      if (new Date(rows[i][expCol]).getTime() < Date.now()) {
        resetSheet.deleteRow(i + 1);
        return { success: false, message: 'ลิงก์นี้หมดอายุแล้ว กรุณาขอลิงก์ใหม่อีกครั้ง' };
      }
      const username = rows[i][userCol];
      const usersSheet = getSheet_(SHEETS.USERS);
      if (!usersSheet) return { success: false, message: 'ไม่พบข้อมูลผู้ใช้งานในระบบ' };
      const uData = usersSheet.getDataRange().getValues();
      const uHeaders = uData[0];
      const uCodeCol = uHeaders.indexOf('username');
      for (let j = 1; j < uData.length; j++) {
        if (String(uData[j][uCodeCol]) === String(username)) {
          const salt = Utilities.getUuid();
          const hash = hashPassword_(newPassword, salt);
          usersSheet.getRange(j + 1, uHeaders.indexOf('salt') + 1).setValue(salt);
          usersSheet.getRange(j + 1, uHeaders.indexOf('passwordHash') + 1).setValue(hash);
          resetSheet.deleteRow(i + 1);
          return { success: true, message: 'ตั้งรหัสผ่านใหม่เรียบร้อยแล้ว กรุณาเข้าสู่ระบบด้วยรหัสผ่านใหม่' };
        }
      }
      return { success: false, message: 'ไม่พบบัญชีผู้ใช้งานที่เกี่ยวข้องกับลิงก์นี้' };
    }
  }
  return { success: false, message: 'ลิงก์นี้หมดอายุหรือไม่ถูกต้อง' };
}

// ---------------------------------------------------------------------
// STUDENTS: CRUD
// ---------------------------------------------------------------------

// ฟิลด์ที่ "ห้ามส่งออกผ่าน API เด็ดขาด" ไม่ว่าจะล็อกอินหรือไม่ก็ตาม
// ต้องการดูค่าจริงต้องเปิด Google Sheet โดยตรงเท่านั้น (เว็บแอปทั้งหมดจะไม่มีทางแสดงข้อมูลเหล่านี้ได้เลย
// แม้แต่ผู้ดูแลระบบที่ล็อกอินแล้วก็ตาม — ลดความเสี่ยงข้อมูลรั่วผ่านเว็บให้เหลือน้อยที่สุด)
const NEVER_EXPORT_FIELDS = ['nationalId', 'phone', 'email', 'address', 'photoUrl'];

// ฟิลด์ที่ "แสดงต่อสาธารณะได้" — ใช้กับ Dashboard และตารางที่ไม่ต้องล็อกอิน
const PUBLIC_STUDENT_FIELDS = [
  'studentCode', 'prefix', 'firstName', 'lastName', 'englishName', 'gender',
  'department', 'major', 'eduLevel', 'eduYear', 'learnerType', 'eduStatus',
  'classroom', 'cohort', 'cnSchoolEn', 'cnCountry', 'cnProvince'
];

/**
 * กรองข้อมูลนักเรียน 1 คนก่อนส่งออกผ่าน API เสมอ
 * full = true  -> คืนทุกฟิลด์ ยกเว้น NEVER_EXPORT_FIELDS (ใช้เมื่อมี token ผู้ดูแลที่ถูกต้องเท่านั้น)
 *                 หมายเหตุ: nationalId, phone, email, address, photoUrl จะไม่ถูกคืนแม้ full=true
 *                 เพราะอยู่ใน NEVER_EXPORT_FIELDS — ต้องเปิด Google Sheet ดูโดยตรงเท่านั้น
 * full = false -> คืนเฉพาะ PUBLIC_STUDENT_FIELDS (ใช้เมื่อไม่ได้ล็อกอิน)
 */
function sanitizeStudent_(row, full) {
  if (!row) return null;
  const fields = full
    ? STUDENT_FIELDS.filter(f => NEVER_EXPORT_FIELDS.indexOf(f) === -1)
    : PUBLIC_STUDENT_FIELDS;
  const out = {};
  fields.forEach(f => { out[f] = row[f] !== undefined ? row[f] : ''; });
  return out;
}

/**
 * รายการนักเรียนสำหรับ Dashboard สาธารณะ — คืนเฉพาะฟิลด์ที่ไม่อ่อนไหวเสมอ
 * (ไม่มีเลขบัตรประชาชน, เบอร์โทร, อีเมล, ที่อยู่ ไม่ว่าใครจะเรียกก็ตาม)
 */
function getStudents_(filters) {
  const sheet = getSheet_(SHEETS.STUDENTS);
  if (!sheet) return [];
  let rows = sheetToObjects_(sheet);

  // ระบบ Filter — ใช้ query string ตรงกับชื่อคอลัมน์ เช่น ?year=2569&department=...
  const filterMap = {
    year: 'eduYear', department: 'department', major: 'major', level: 'eduLevel',
    status: 'eduStatus', cnSchool: 'cnSchoolEn', cohort: 'cohort'
  };
  Object.keys(filterMap).forEach(key => {
    const value = filters[key];
    if (value) {
      const field = filterMap[key];
      rows = rows.filter(r => String(r[field] || '') === String(value));
    }
  });

  // ค้นหาบางส่วน (partial match) หลายคอลัมน์พร้อมกัน — ?q=สม
  if (filters.q) {
    const q = String(filters.q).toLowerCase();
    const searchable = ['studentCode', 'firstName', 'lastName', 'englishName', 'major', 'department', 'cnSchoolEn', 'eduStatus'];
    rows = rows.filter(r => searchable.some(f => String(r[f] || '').toLowerCase().includes(q)));
  }

  // สำคัญ: sanitize ทุกแถวก่อนส่งออกเสมอ — รายการ list นี้ไม่ส่งข้อมูลอ่อนไหวไม่ว่าใครจะเรียก
  return rows.map(r => sanitizeStudent_(r, false));
}

/**
 * เช็คว่ารหัสนักเรียนนี้มีอยู่แล้วในระบบหรือไม่ — ใช้ก่อนบันทึกตอน "เพิ่มนักเรียนใหม่"
 * เพื่อกันแอดมินเผลอกรอกรหัสซ้ำแล้วไปเขียนทับข้อมูลคนเดิมโดยไม่ตั้งใจ
 * (คืนแค่ชื่อ+แผนกซึ่งเป็นข้อมูลสาธารณะอยู่แล้ว ไม่ใช่ข้อมูลอ่อนไหว)
 */
function checkStudentCode_(studentCode) {
  if (!studentCode) return { success: false, message: 'กรุณาระบุรหัสนักเรียนที่ต้องการตรวจสอบ' };
  const sheet = getSheet_(SHEETS.STUDENTS);
  if (!sheet) return { success: true, exists: false };
  const rows = sheetToObjects_(sheet);
  const found = rows.find(r => String(r.studentCode) === String(studentCode));
  if (!found) return { success: true, exists: false };
  return {
    success: true,
    exists: true,
    name: (found.prefix || '') + (found.firstName || '') + ' ' + (found.lastName || ''),
    department: found.department || ''
  };
}

/**
 * ข้อมูลนักเรียนรายบุคคลแบบละเอียด (หน้า Student Profile)
 * - ไม่มี token ที่ถูกต้อง -> คืนแค่ฟิลด์สาธารณะเหมือน getStudents_
 * - มี token ที่ถูกต้อง    -> คืนทุกฟิลด์ ยกเว้นกลุ่มข้อมูลใน NEVER_EXPORT_FIELDS (nationalId, phone, email, address, photoUrl)
 */
function getStudent_(id, token) {
  if (!id) return { success: false, message: 'กรุณาระบุรหัสนักเรียน (id)' };
  const sheet = getSheet_(SHEETS.STUDENTS);
  if (!sheet) return { success: false, message: 'ไม่พบชีตข้อมูลนักเรียน' };
  const rows = sheetToObjects_(sheet);
  const student = rows.find(r => String(r.id) === String(id) || String(r.studentCode) === String(id));
  if (!student) return { success: false, message: 'ไม่พบข้อมูลนักเรียนรหัสนี้' };

  const isAuthed = isValidSession_(token);
  return {
    success: true,
    authenticated: isAuthed,
    student: sanitizeStudent_(student, isAuthed)
  };
}

function saveStudent_(payload) {
  if (!payload || !payload.studentCode) {
    return { success: false, message: 'กรุณาระบุรหัสนักเรียน (studentCode)' };
  }
  const sheet = getOrCreateSheet_(SHEETS.STUDENTS, STUDENT_FIELDS);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const codeCol = headers.indexOf('studentCode');
  let rowIndex = -1;

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][codeCol]) === String(payload.studentCode)) {
      rowIndex = i + 1; // แถวจริงใน sheet (1-indexed)
      break;
    }
  }

  const now = new Date().toISOString();
  const isUpdate = rowIndex !== -1;

  // ป้องกันการเขียนทับรหัสนักเรียนที่มีอยู่แล้วโดยไม่ตั้งใจ: ถ้าฟอร์มส่ง forceCreate ไม่มา
  // และเป็นการ "เพิ่มใหม่" (ไม่ใช่แก้ไขที่ตั้งใจ) แต่ดันเจอรหัสซ้ำ ให้ปฏิเสธแล้วแจ้งกลับไป
  // (ฝั่งหน้าเว็บควรเช็คด้วย checkStudentCode_ ก่อนอยู่แล้ว แต่เช็คซ้ำที่นี่กันกรณีเลี่ยงหน้าเว็บมายิง API ตรง)
  if (isUpdate && payload.isNewRecord === true) {
    return {
      success: false,
      message: 'รหัสนักเรียน "' + payload.studentCode + '" มีอยู่แล้วในระบบ กรุณาใช้รหัสอื่น หรือแก้ไขข้อมูลนักเรียนคนนี้แทนการเพิ่มใหม่'
    };
  }

  const rowValues = headers.map(field => {
    if (field === 'id') return isUpdate ? data[rowIndex - 1][headers.indexOf('id')] : Utilities.getUuid();
    if (field === 'createdAt') return isUpdate ? data[rowIndex - 1][headers.indexOf('createdAt')] : now;
    if (field === 'updatedAt') return now;
    // ฟิลด์อ่อนไหว (NEVER_EXPORT_FIELDS) ไม่เคยถูกส่งกลับไปให้ฟอร์มเห็นค่าจริงเลย ดังนั้นถ้าฟอร์มส่งค่าว่างมา
    // ตอนแก้ไขข้อมูลเดิม ให้ "เก็บค่าเดิมไว้" แทนการเขียนทับด้วยค่าว่าง — ป้องกันข้อมูลหายโดยไม่ตั้งใจ
    if (isUpdate && NEVER_EXPORT_FIELDS.indexOf(field) !== -1) {
      const incoming = payload[field];
      if (incoming === undefined || incoming === '') {
        return data[rowIndex - 1][headers.indexOf(field)];
      }
      return incoming; // แอดมินตั้งใจกรอกค่าใหม่จริง ๆ (เช่นแก้เบอร์โทรที่พิมพ์เองใหม่)
    }
    return payload[field] !== undefined ? payload[field] : '';
  });

  if (isUpdate) {
    sheet.getRange(rowIndex, 1, 1, headers.length).setValues([rowValues]);
    addEditLog_(payload.studentCode, 'แก้ไขข้อมูลนักเรียน', payload.editedBy || 'ผู้ดูแลระบบ');
    return { success: true, message: 'อัปเดตข้อมูลนักเรียนเรียบร้อยแล้ว', id: rowValues[headers.indexOf('id')] };
  } else {
    sheet.appendRow(rowValues);
    addEditLog_(payload.studentCode, 'สร้างระเบียนนักเรียนใหม่', payload.editedBy || 'ผู้ดูแลระบบ');
    return { success: true, message: 'เพิ่มข้อมูลนักเรียนใหม่เรียบร้อยแล้ว', id: rowValues[headers.indexOf('id')] };
  }
}

/**
 * อัปโหลดรูปนักเรียนไปเก็บที่ Google Drive โดยตรง
 * payload: { studentCode, fileName, base64Data ('data:image/...;base64,....'), token }
 * คืน photoUrl กลับไปให้ฟอร์มใช้แสดงผลทันที (ไม่ผ่าน getStudent_ เพราะ photoUrl อยู่ใน NEVER_EXPORT_FIELDS)
 */
function uploadPhoto_(payload) {
  if (!payload || !payload.base64Data || !payload.fileName) {
    return { success: false, message: 'ข้อมูลไฟล์รูปภาพไม่ครบถ้วน' };
  }
  if (PHOTO_FOLDER_ID === 'YOUR_GOOGLE_DRIVE_FOLDER_ID_HERE') {
    return { success: false, message: 'ยังไม่ได้ตั้งค่า PHOTO_FOLDER_ID ใน Code.gs กรุณาแจ้งผู้ดูแลระบบ' };
  }
  try {
    const matches = String(payload.base64Data).match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
    if (!matches) return { success: false, message: 'รูปแบบไฟล์รูปภาพไม่ถูกต้อง (ต้องเป็น JPG/PNG)' };
    const mimeType = matches[1];
    const rawBase64 = matches[2];

    // จำกัดขนาดไฟล์ไม่เกิน ~4MB หลัง decode (กัน payload ใหญ่เกินไปทำให้ Apps Script ทำงานช้า/พัง)
    const approxBytes = rawBase64.length * 0.75;
    if (approxBytes > 4 * 1024 * 1024) {
      return { success: false, message: 'ไฟล์รูปภาพมีขนาดใหญ่เกินไป (จำกัดไม่เกิน 4MB)' };
    }

    const bytes = Utilities.base64Decode(rawBase64);
    const ext = mimeType.split('/')[1].replace('jpeg', 'jpg');
    const safeName = (payload.studentCode || 'student').replace(/[^a-zA-Z0-9_-]/g, '');
    const blob = Utilities.newBlob(bytes, mimeType, safeName + '_' + new Date().getTime() + '.' + ext);

    const folder = DriveApp.getFolderById(PHOTO_FOLDER_ID);
    const file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    const photoUrl = 'https://drive.google.com/uc?export=view&id=' + file.getId();

    // ถ้ามีรหัสนักเรียนอยู่แล้วในชีต ให้อัปเดต photoUrl ให้ทันที (กรณีอัปโหลดรูปตอนแก้ไขข้อมูลที่มีอยู่แล้ว)
    if (payload.studentCode) updateStudentPhotoUrl_(payload.studentCode, photoUrl);

    return { success: true, photoUrl: photoUrl, fileId: file.getId(), message: 'อัปโหลดรูปภาพเรียบร้อยแล้ว' };
  } catch (err) {
    return { success: false, message: 'อัปโหลดรูปภาพไม่สำเร็จ: ' + safeErr_(err) };
  }
}

function updateStudentPhotoUrl_(studentCode, photoUrl) {
  const sheet = getSheet_(SHEETS.STUDENTS);
  if (!sheet) return;
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const codeCol = headers.indexOf('studentCode');
  const photoCol = headers.indexOf('photoUrl');
  if (photoCol === -1) return;
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][codeCol]) === String(studentCode)) {
      sheet.getRange(i + 1, photoCol + 1).setValue(photoUrl);
      break;
    }
  }
}


function deleteStudent_(id) {
  if (!id) return { success: false, message: 'กรุณาระบุรหัสนักเรียนที่ต้องการลบ' };
  const sheet = getSheet_(SHEETS.STUDENTS);
  if (!sheet) return { success: false, message: 'ไม่พบชีตข้อมูลนักเรียน' };

  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const idCol = headers.indexOf('id');
  const codeCol = headers.indexOf('studentCode');

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][idCol]) === String(id) || String(data[i][codeCol]) === String(id)) {
      sheet.deleteRow(i + 1);
      addEditLog_(data[i][codeCol], 'ลบข้อมูลนักเรียนออกจากระบบ', 'ผู้ดูแลระบบ');
      return { success: true, message: 'ลบข้อมูลนักเรียนเรียบร้อยแล้ว' };
    }
  }
  return { success: false, message: 'ไม่พบข้อมูลนักเรียนที่ต้องการลบ' };
}

function addEditLog_(studentCode, action, editedBy) {
  try {
    const sheet = getOrCreateSheet_(SHEETS.EDIT_LOG, ['timestamp', 'studentCode', 'action', 'editedBy']);
    sheet.appendRow([new Date().toISOString(), studentCode || '', action, editedBy || '']);
  } catch (err) {
    // ไม่ให้การบันทึก log ที่ล้มเหลวไปกระทบการทำงานหลัก
    Logger.log('บันทึก edit log ไม่สำเร็จ: ' + safeErr_(err));
  }
}

// ---------------------------------------------------------------------
// DASHBOARD STATS
// ---------------------------------------------------------------------

function getDashboardStats_(filters) {
  const students = getStudents_(filters || {});
  const dualDegree = students.filter(s => s.learnerType === 'ทวิวุฒิ' || s.cnSchoolEn);

  const byDept = countBy_(students, 'department');
  const byStatus = countBy_(dualDegree, 'eduStatus');
  const byYear = countBy_(dualDegree, 'eduYear');
  const byChinaSchool = countBy_(dualDegree, 'cnSchoolEn');
  const byLevel = countBy_(dualDegree, 'eduLevel');

  return {
    totalStudents: students.length,
    totalDualDegree: dualDegree.length,
    studying: dualDegree.filter(s => s.eduStatus === 'กำลังศึกษา').length,
    graduated: dualDegree.filter(s => s.eduStatus === 'สำเร็จการศึกษา').length,
    chinaSchoolCount: Object.keys(byChinaSchool).length,
    byDept, byStatus, byYear, byChinaSchool, byLevel
  };
}

function countBy_(rows, field) {
  const result = {};
  rows.forEach(r => {
    const key = r[field] || 'ไม่ระบุ';
    result[key] = (result[key] || 0) + 1;
  });
  return result;
}

// ---------------------------------------------------------------------
// MASTER DATA
// ---------------------------------------------------------------------

// หมวดหมู่ Master Data ทั้งหมดที่หน้า master-data.html จะจัดการได้
const MASTER_CATEGORIES = [
  { key: 'years', label: 'ปีการศึกษา' },
  { key: 'departments', label: 'แผนกวิชา' },
  { key: 'majors', label: 'สาขาวิชา' },
  { key: 'eduLevels', label: 'ระดับการศึกษา' },
  { key: 'eduStatuses', label: 'สถานะนักเรียน' },
  { key: 'chinaSchools', label: 'สถานศึกษาจีน' },
  { key: 'provinces', label: 'จังหวัด/มณฑล' },
  { key: 'countries', label: 'ประเทศ' },
  { key: 'curricula', label: 'หลักสูตร' },
  { key: 'cohorts', label: 'รุ่น' },
  { key: 'classrooms', label: 'ห้องเรียน' }
];

const MASTER_DEFAULTS = {
  years: ['2567', '2568', '2569'],
  departments: ['ช่างยนต์','ช่างไฟฟ้า','ช่างกลโรงงาน','ช่างเชื่อมโลหะ','ช่างก่อสร้าง','ช่างอิเล็กทรอนิกส์','เมคคาทรอนิกส์','ยานยนต์ไฟฟ้า','สถาปัตยกรรม','การโรงแรม','การบัญชี','การตลาด','เทคโนโลยีธุรกิจดิจิทัล'],
  eduLevels: ['ปวช.', 'ปวส.'],
  eduStatuses: ['กำลังศึกษา', 'สำเร็จการศึกษา', 'พักการศึกษา', 'ลาออก', 'พ้นสภาพ'],
  majors: [], chinaSchools: [], provinces: [], countries: ['ไทย', 'จีน'], curricula: [], cohorts: [], classrooms: []
};

/**
 * โครงสร้างชีต MasterData: id | category | value | order
 * คืนค่าเป็น object ที่แต่ละ category มี array ของ {id, value} เรียงตาม order
 * ถ้ายังไม่เคยสร้างชีต หรือ category ยังไม่มีข้อมูล จะคืนค่าเริ่มต้นจาก MASTER_DEFAULTS แทน (ไม่มี id)
 */
function getMasterData_() {
  const sheet = getSheet_(SHEETS.MASTER);
  const grouped = {};
  MASTER_CATEGORIES.forEach(c => { grouped[c.key] = []; });

  if (sheet) {
    const rows = sheetToObjects_(sheet); // { id, category, value, order }
    rows
      .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0))
      .forEach(r => {
        if (!r.category || !grouped[r.category]) return;
        grouped[r.category].push({ id: r.id, value: r.value });
      });
  }

  // เติมค่าเริ่มต้นเฉพาะ category ที่ยังไม่มีข้อมูลจริงในชีต
  MASTER_CATEGORIES.forEach(c => {
    if (grouped[c.key].length === 0 && MASTER_DEFAULTS[c.key]) {
      grouped[c.key] = MASTER_DEFAULTS[c.key].map(v => ({ id: '', value: v }));
    }
  });

  return { categories: MASTER_CATEGORIES, items: grouped };
}

function saveMasterItem_(payload) {
  if (!payload || !payload.category || !payload.value) {
    return { success: false, message: 'กรุณาระบุหมวดหมู่และค่าที่ต้องการบันทึก' };
  }
  if (!MASTER_CATEGORIES.some(c => c.key === payload.category)) {
    return { success: false, message: 'หมวดหมู่ไม่ถูกต้อง: ' + payload.category };
  }
  const sheet = getOrCreateSheet_(SHEETS.MASTER, ['id', 'category', 'value', 'order']);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const idCol = headers.indexOf('id');

  if (payload.id) {
    // แก้ไขรายการเดิม
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][idCol]) === String(payload.id)) {
        sheet.getRange(i + 1, headers.indexOf('value') + 1).setValue(payload.value);
        return { success: true, message: 'แก้ไขข้อมูลพื้นฐานเรียบร้อยแล้ว' };
      }
    }
    return { success: false, message: 'ไม่พบรายการที่ต้องการแก้ไข' };
  }

  // เพิ่มรายการใหม่ต่อท้ายหมวดหมู่นั้น
  const order = data.filter(r => r[headers.indexOf('category')] === payload.category).length;
  sheet.appendRow([Utilities.getUuid(), payload.category, payload.value, order]);
  return { success: true, message: 'เพิ่มข้อมูลพื้นฐานใหม่เรียบร้อยแล้ว' };
}

function deleteMasterItem_(id) {
  if (!id) return { success: false, message: 'กรุณาระบุรายการที่ต้องการลบ' };
  const sheet = getSheet_(SHEETS.MASTER);
  if (!sheet) return { success: false, message: 'ไม่พบชีตข้อมูลพื้นฐาน (MasterData)' };
  const data = sheet.getDataRange().getValues();
  const idCol = data[0].indexOf('id');
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][idCol]) === String(id)) {
      sheet.deleteRow(i + 1);
      return { success: true, message: 'ลบข้อมูลพื้นฐานเรียบร้อยแล้ว' };
    }
  }
  return { success: false, message: 'ไม่พบรายการที่ต้องการลบ' };
}

// ---------------------------------------------------------------------
// UTILITIES (safe sheet access, JSON helpers)
// ---------------------------------------------------------------------

function getSheet_(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss ? ss.getSheetByName(name) : null;
}

function getOrCreateSheet_(name, headers) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(headers);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

/** แปลงข้อมูลในชีตเป็น array ของ object โดยอิงหัวตารางแถวแรก (ป้องกัน null/undefined) */
function sheetToObjects_(sheet) {
  if (!sheet) return [];
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  const headers = values[0];
  return values.slice(1)
    .filter(row => row.some(cell => cell !== '' && cell !== null))
    .map(row => {
      const obj = {};
      headers.forEach((h, i) => { obj[h] = row[i] !== undefined ? row[i] : ''; });
      return obj;
    });
}

/** ส่งข้อมูลกลับเป็น JSON เสมอ พร้อมป้องกัน error ที่ serialize ไม่ได้ */
function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function safeErr_(err) {
  return (err && err.message) ? err.message : String(err);
}
