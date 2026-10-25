/* ============================================================
   RelTest Lab — single-file artifact
   Data model (db capability):
     config/app          { adminPasscode, seededAt }
     chambers/{id}        { name, setPoint, status, requestId, requestNo }
     requests/{id}        { requestNo, productName, testCondition, testStandard,
                             quantity, priority, department, requesterName, requesterEmpId,
                             remark, status, chamberId, chamberName,
                             startDateTime, endDateTime, createdAt, scheduledAt, report:{...} }
   ============================================================ */

let db = null;
let downloadsCap = null;
let assetsCap = null;
let CURRENT_USER = null;      // { empId, name, dept, role }
let REQUESTS = [];
let CHAMBERS = [];
let EMPLOYEES = [];
let unsubRequests = null, unsubChambers = null, unsubEmployees = null;
let currentPage = 'add-request';
let planRefDate = new Date();
let calChamberFilter = 'all';
let calAdminChamber = null;
let calSubTab = 'list';
const THAI_MONTHS = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];
let tempSimTimer = null;

/* ---------- LPN lines ---------- */
const LINES = ['LPN1','LPN2'];
const LINE_LABEL = { LPN1:'LPN 1', LPN2:'LPN 2', all:'ทั้งหมด' };
let calLine = 'LPN1';   // ตารางแพลนงาน
let kpiLine = 'all';    // สรุป KPI
function chamberLine(c){ return (c && c.line) || 'LPN1'; }
function chambersOfLine(line){ return line==='all' ? CHAMBERS : CHAMBERS.filter(c=>chamberLine(c)===line); }
function requestLine(r){
  if(r.chamberId){ const c = CHAMBERS.find(x=>x.id===r.chamberId); if(c) return chamberLine(c); }
  return r.line || null;
}
function filterByLine(list, line){ return line==='all' ? list : list.filter(r=>requestLine(r)===line); }
function lineTag(line){ return `<span class="line-tag ${line==='LPN2'?'lpn2':''}">${LINE_LABEL[line]||line}</span>`; }
function lineSwitchHtml(current, setter, withAll){
  const opts = withAll ? ['all', ...LINES] : LINES;
  return `<div class="line-switch">${opts.map(l=>`<button class="${current===l?'active':''}" onclick="${setter}='${l}'; render();">${LINE_LABEL[l]}</button>`).join('')}</div>`;
}

/* ---------- small utils ---------- */
function uid(){ return Math.random().toString(36).slice(2,10) + Date.now().toString(36).slice(-4); }
function pad(n){ return String(n).padStart(2,'0'); }
function fmtDateTime(iso){
  if(!iso) return '—';
  const d = new Date(iso);
  if(isNaN(d)) return '—';
  return `${pad(d.getDate())}/${pad(d.getMonth()+1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fmtDate(iso){
  if(!iso) return '—';
  const d = new Date(iso);
  if(isNaN(d)) return '—';
  return `${pad(d.getDate())}/${pad(d.getMonth()+1)}/${d.getFullYear()}`;
}
function fmtDur(ms){
  if(ms==null || isNaN(ms)) return '—';
  const neg = ms<0; ms = Math.abs(ms);
  const h = Math.floor(ms/3600000);
  const m = Math.floor((ms%3600000)/60000);
  const d = Math.floor(h/24);
  let s = d>0 ? `${d}d ${h%24}h` : `${h}h ${m}m`;
  return (neg?'-':'') + s;
}
function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function toast(msg, isErr){
  const el = document.createElement('div');
  el.className = 'toast';
  if(isErr) el.style.borderColor = 'var(--danger)';
  el.textContent = msg;
  document.getElementById('toast-root').appendChild(el);
  setTimeout(()=>el.remove(), 3400);
}
function localGet(k){ try{ return JSON.parse(localStorage.getItem(k)); }catch(e){ return null; } }
function localSet(k,v){ try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} }

/* ---------- login (employee ID + last-4-digit password) ---------- */
function last4(empId){ return String(empId).slice(-4); }

async function doLogin(){
  const empId = document.getElementById('login-empid').value.trim();
  const pass = document.getElementById('login-pass').value;
  const err = document.getElementById('login-err');
  err.textContent = '';
  if(!/^\d{6}$/.test(empId)){ err.textContent = 'กรุณากรอกรหัสพนักงานเป็นตัวเลข 6 หลัก'; return; }
  if(!pass){ err.textContent = 'กรุณากรอกรหัสผ่าน'; return; }
  try{
    CURRENT_USER = await Api.login(empId, pass);
    enterApp();
  }catch(e){ err.textContent = e.message || 'เข้าสู่ระบบไม่สำเร็จ'; }
}

function doLogout(){
  CURRENT_USER = null;
  Api.logout();
  document.getElementById('app').style.display = 'none';
  document.getElementById('login-screen').style.display = 'flex';
  if(unsubRequests) unsubRequests();
  if(unsubChambers) unsubChambers();
  if(unsubEmployees) unsubEmployees();
  if(tempSimTimer) clearInterval(tempSimTimer);
}

/* ---------- boot ---------- */
async function boot(){
  db = Api.db;
  downloadsCap = Api.downloads;
  assetsCap = Api.assets;

  // restore the session if a valid token is stored
  if(Api.hasToken()){
    try{
      CURRENT_USER = await Api.me();
      enterApp();
    }catch(e){ Api.clearToken(); }
  }
}

function enterApp(){
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app').style.display = 'block';
  document.getElementById('user-avatar').textContent = CURRENT_USER.name.trim().charAt(0).toUpperCase();
  document.getElementById('user-name-tag').textContent = CURRENT_USER.name;
  document.getElementById('user-role-tag').textContent = (CURRENT_USER.role==='admin'?'Admin':'Requester') + ' · ' + CURRENT_USER.dept + ' · ' + CURRENT_USER.empId;
  buildNav();
  subscribeData();
  navigate(CURRENT_USER.role==='admin' ? 'dashboard' : 'add-request');
  startTempSim();
}

/* ---------- nav ---------- */
const NAV_REQUESTER = [
  {id:'add-request', icon:'＋', label:'Add New Request'},
  {id:'timeline-calc', icon:'⏱', label:'คำนวณระยะเวลาทดสอบ'},
  {id:'calendar', icon:'▦', label:'ตารางแพลนงาน'},
  {id:'dashboard', icon:'◧', label:'Dashboard เครื่องทดสอบ'},
];
const NAV_ADMIN = [
  {id:'dashboard', icon:'◧', label:'Dashboard เครื่องทดสอบ'},
  {id:'calendar', icon:'▦', label:'ตารางแพลนงาน'},
  {id:'add-request', icon:'＋', label:'Add New Request'},
  {id:'timeline-calc', icon:'⏱', label:'คำนวณระยะเวลาทดสอบ'},
  {id:'requests', icon:'☰', label:'รายการ Request ทั้งหมด'},
  {id:'report', icon:'▤', label:'ออก Report (Word)'},
  {id:'kpi', icon:'◔', label:'สรุป KPI'},
  {id:'settings', icon:'⚙', label:'ตั้งค่าระบบ'},
];
function buildNav(){
  const items = CURRENT_USER.role==='admin' ? NAV_ADMIN : NAV_REQUESTER;
  const el = document.getElementById('nav-items');
  el.innerHTML = items.map(it=>`<button class="nav-item" data-nav="${it.id}" onclick="navigate('${it.id}')"><span class="nav-icon">${it.icon}</span>${esc(it.label)}</button>`).join('');
}
function navigate(page){
  currentPage = page;
  document.querySelectorAll('.nav-item').forEach(b=>b.classList.toggle('active', b.dataset.nav===page));
  document.getElementById('sidebar').classList.remove('open');
  render();
}

/* ---------- data subscriptions ---------- */
function subscribeData(){
  if(!db) return;
  unsubRequests = db.collection('requests').onSnapshot(snap=>{
    REQUESTS = snap.docs.map(d=>({ id: d.id, ...d.data() }));
    REQUESTS.sort((a,b)=> new Date(b.createdAt||0) - new Date(a.createdAt||0));
    render();
  }, err=>{ console.error(err); });
  unsubChambers = db.collection('chambers').onSnapshot(snap=>{
    CHAMBERS = snap.docs.map(d=>({ id: d.id, ...d.data(), liveTemp: (CHAMBERS.find(c=>c.id===d.id)||{}).liveTemp }));
    render();
  }, err=>{ console.error(err); });
  unsubEmployees = db.collection('employees').onSnapshot(snap=>{
    EMPLOYEES = snap.docs.map(d=>({ id: d.id, ...d.data() }));
    if(currentPage === 'settings') render();
  }, err=>{ console.error(err); });
}

/* ---------- temp simulation (client-side, per-viewer visual only) ---------- */
function startTempSim(){
  if(tempSimTimer) clearInterval(tempSimTimer);
  tempSimTimer = setInterval(()=>{
    CHAMBERS.forEach(c=>{
      const target = c.status === 'running' ? c.setPoint : 25;
      const cur = (c.liveTemp==null) ? target : c.liveTemp;
      const drift = (target - cur) * 0.18 + (Math.random()-0.5)*0.6;
      c.liveTemp = Math.round((cur + drift) * 10)/10;
    });
    if(currentPage === 'dashboard') renderDashboardTemps();
  }, 1800);
}

/* ---------- render router ---------- */
function render(){
  const root = document.getElementById('page-root');
  if(!root) return;
  switch(currentPage){
    case 'add-request': root.innerHTML = pageAddRequest(); break;
    case 'timeline-calc': root.innerHTML = pageTimelineCalc(); initTimelineCalc(); break;
    case 'calendar': root.innerHTML = pageCalendarHub(); break;
    case 'dashboard': root.innerHTML = pageDashboard(); break;
    case 'requests': root.innerHTML = pageAllRequests(); break;
    case 'report': root.innerHTML = pageReport(); break;
    case 'kpi': root.innerHTML = pageKpi(); break;
    case 'settings': root.innerHTML = pageSettings(); break;
    default: root.innerHTML = '';
  }
}

/* ============================================================
   PAGE: Add New Request
   ============================================================ */
function pageAddRequest(){
  const userInitial = CURRENT_USER && CURRENT_USER.name ? CURRENT_USER.name.trim().charAt(0).toUpperCase() : 'U';
  return `
  <div class="page-head">
    <div><h2>Add New Request</h2><div class="sub">กรอกรายละเอียดคำขอทดสอบความคงทน — ทีม Admin จะรับงานและแพลนคิวให้ในลำดับถัดไป</div></div>
  </div>

  <div class="card req-form-card">
    <!-- ผู้ส่งคำขอ -->
    <div class="req-user-bar">
      <div class="req-user-avatar">${userInitial}</div>
      <div class="req-user-info">
        <div class="req-user-name">
          <span>${esc(CURRENT_USER.name)}</span>
          <span class="badge badge-scheduled" style="font-size:10.5px;padding:2px 8px;">ผู้ส่งคำขอ</span>
        </div>
        <div class="req-user-meta">แผนก: <b>${esc(CURRENT_USER.dept)}</b> &nbsp;·&nbsp; รหัสพนักงาน: <b>${esc(CURRENT_USER.empId)}</b></div>
      </div>
    </div>

    <div class="req-form-layout">
      <!-- ส่วนที่ 1: ข้อมูลชิ้นงานและการทดสอบ -->
      <div class="form-section">
        <div class="form-section-title">
          <span class="sec-num">1</span>
          <span>ข้อมูลชิ้นงานและเงื่อนไขการทดสอบ</span>
        </div>
        <div class="form-grid">
          <div class="full">
            <label class="form-label">ชื่อผลิตภัณฑ์ / ชิ้นงาน <span class="req-star">*</span></label>
            <input id="f-product" class="form-input" placeholder="เช่น Housing Cover Rev.C หรือ Mainboard PCBA">
            <span class="field-hint">ระบุชื่อรุ่น ชิ้นส่วน หรือ Part Number ที่ต้องการส่งทดสอบ</span>
          </div>

          <div>
            <label class="form-label">Rel Test Condition <span class="req-star">*</span></label>
            <select id="f-condition" class="form-input">
              <option>Thermal Shock</option>
              <option>Thermal Cycling</option>
              <option>High Temp Storage</option>
              <option>Low Temp Storage</option>
              <option>Humidity / Damp Heat</option>
              <option>Vibration</option>
              <option>Drop Test</option>
              <option>IP Rating (Water/Dust)</option>
              <option>Other</option>
            </select>
            <span class="field-hint">เลือกประเภทการทดสอบความคงทน</span>
          </div>

          <div>
            <label class="form-label">Test Condition</label>
            <input id="f-standard" class="form-input" placeholder="เช่น 85°C / 85% RH, 500 hrs หรือ IEC 60068-2-14">
            <span class="field-hint">ระบุสภาวะหรือมาตรฐานที่ต้องการทดสอบ</span>
          </div>

          <div>
            <label class="form-label">ฝั่ง (Line) <span class="req-star">*</span></label>
            <select id="f-line" class="form-input">
              ${LINES.map(l=>`<option value="${l}">${LINE_LABEL[l]}</option>`).join('')}
            </select>
            <span class="field-hint">เลือกไลน์หรือโซนการผลิตที่เกี่ยวข้อง</span>
          </div>

          <div>
            <label class="form-label">จำนวนตัวอย่าง (Quantity) <span class="req-star">*</span></label>
            <div class="input-unit-wrap">
              <input id="f-qty" class="form-input" type="number" min="1" value="1">
              <span class="input-unit">ชิ้น / pcs</span>
            </div>
            <span class="field-hint">จำนวนชิ้นงานตัวอย่างที่ส่งทดสอบ</span>
          </div>
        </div>

        <div class="form-section-tip" style="margin-top:16px;">
          <span style="font-size:16px;">💡</span>
          <span style="font-size:12px;color:var(--muted);line-height:1.5;">ตรวจสอบประเภทและสภาวะการทดสอบให้ครบถ้วน ข้อมูลนี้จะใช้ในการจัดคิว Chamber และออก Report</span>
        </div>
      </div>

      <!-- ส่วนที่ 2: ความเร่งด่วนและหมายเหตุ -->
      <div class="form-section">
        <div class="form-section-title">
          <span class="sec-num">2</span>
          <span>ความเร่งด่วนและหมายเหตุเพิ่มเติม</span>
        </div>
        <div class="form-grid">
          <div class="full">
            <label class="form-label">ระดับความเร่งด่วน</label>
            <div class="priority-selector">
              <label class="priority-opt">
                <input type="radio" name="priority-radio" value="Normal" checked onchange="document.getElementById('f-priority').value='Normal'">
                <span class="priority-card">
                  <span class="priority-badge p-normal">Normal</span>
                  <span class="priority-desc">ทดสอบตามลำดับคิวปกติ</span>
                </span>
              </label>
              <label class="priority-opt">
                <input type="radio" name="priority-radio" value="Urgent" onchange="document.getElementById('f-priority').value='Urgent'">
                <span class="priority-card">
                  <span class="priority-badge p-urgent">Urgent</span>
                  <span class="priority-desc">งานเร่งด่วนพิเศษ / มีผลต่อการผลิตหรือส่งมอบ</span>
                </span>
              </label>
              <input type="hidden" id="f-priority" value="Normal">
            </div>
          </div>

          <div class="full">
            <label class="form-label">วัตถุประสงค์ / รายละเอียดเพิ่มเติม (Remark)</label>
            <textarea id="f-remark" class="form-input" rows="2" placeholder="ระบุวัตถุประสงค์ เช่น เพื่อรับรองวัสดุใหม่, ข้อควรระวังพิเศษ หรือวันที่ต้องการทราบผล"></textarea>
          </div>

          <!-- แนบไฟล์หรือรูปภาพ -->
          <div class="full">
            <label class="form-label">
              แนบไฟล์หรือรูปภาพ (Attachments)
            </label>
            <div class="file-dropzone-wrap">
              <div class="file-dropzone" 
                   onclick="document.getElementById('f-attachment-input').click()"
                   ondragover="handleReqDragOver(event)"
                   ondragleave="handleReqDragLeave(event)"
                   ondrop="handleReqDrop(event)">
                <div class="file-dropzone-icon">📁</div>
                <div class="file-dropzone-title">คลิกเพื่อเลือกไฟล์ หรือ ลากและวางไฟล์ลงที่นี่</div>
                <div class="file-dropzone-hint">
                  รองรับไฟล์รูปภาพ (PNG, JPG, JPEG, WEBP, GIF) และเอกสาร (PDF, Word, Excel, CSV, ZIP) สูงสุด 25MB ต่อไฟล์
                </div>
                <div class="file-paste-badge">💡 สามารถกด Ctrl + V เพื่อวางรูปภาพจากคลิปบอร์ดได้โดยตรง</div>
                <input type="file" id="f-attachment-input" multiple style="display:none;" onchange="handleReqFileInputChange(this.files)" accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.zip,.7z,.rar">
              </div>
              <div id="req-file-preview-list" class="attached-files-grid">
                ${renderReqFilesHtml()}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ปุ่มดำเนินการ -->
    <div class="form-actions-bar">
      <button type="button" class="btn" onclick="resetRequestForm()">ล้างข้อมูล</button>
      <button type="button" class="btn btn-primary btn-submit" onclick="submitRequest()">
        <span>✓</span> ส่ง Request
      </button>
    </div>
  </div>`;
}

/* ---------- Attachment state & handling for Add Request ---------- */
let reqSelectedFiles = []; // { file, previewUrl, name, size, type, isImage }

function fmtFileSize(bytes){
  if(!bytes && bytes !== 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function getFileExt(filename){
  return String(filename || '').split('.').pop().toLowerCase();
}

function getFileIconMeta(filename){
  const ext = getFileExt(filename);
  if(['pdf'].includes(ext)) return { cls: 'doc-pdf', label: 'PDF' };
  if(['doc', 'docx'].includes(ext)) return { cls: 'doc-word', label: 'DOC' };
  if(['xls', 'xlsx', 'csv'].includes(ext)) return { cls: 'doc-excel', label: 'XLS' };
  if(['zip', '7z', 'rar', 'tar', 'gz'].includes(ext)) return { cls: 'doc-zip', label: 'ZIP' };
  return { cls: 'doc-other', label: (ext || 'FILE').toUpperCase().slice(0, 4) };
}

function renderReqFilesHtml(){
  if(!reqSelectedFiles || !reqSelectedFiles.length) return '';
  return reqSelectedFiles.map((item, idx)=>{
    const isImg = item.isImage;
    const iconMeta = getFileIconMeta(item.name);
    return `
      <div class="attached-file-card">
        ${isImg 
          ? `<img src="${item.previewUrl}" class="attached-file-thumb" onclick="showImageLightbox('${item.previewUrl}', '${esc(item.name)}')" title="คลิกเพื่อดูรูปภาพขนาดใหญ่">`
          : `<div class="attached-file-doc-icon ${iconMeta.cls}">${iconMeta.label}</div>`
        }
        <div class="attached-file-info" title="${esc(item.name)}">
          <div class="attached-file-name" ${isImg ? `onclick="showImageLightbox('${item.previewUrl}', '${esc(item.name)}')"` : ''}>${esc(item.name)}</div>
          <div class="attached-file-size">${fmtFileSize(item.size)}</div>
        </div>
        <button type="button" class="attached-file-del" onclick="removeReqFile(${idx})" title="ลบไฟล์นี้">✕</button>
      </div>
    `;
  }).join('');
}

function handleReqFileSelect(files){
  if(!files || !files.length) return;
  const maxBytes = 25 * 1024 * 1024;
  let added = 0;
  for(let i = 0; i < files.length; i++){
    const file = files[i];
    if(file.size > maxBytes){
      toast(`ไฟล์ "${file.name}" มีขนาดเกิน 25MB`, true);
      continue;
    }
    if(reqSelectedFiles.some(f => f.name === file.name && f.size === file.size)){
      continue;
    }
    const ext = getFileExt(file.name);
    const isImage = (file.type && file.type.startsWith('image/')) || ['png','jpg','jpeg','webp','gif','bmp','svg'].includes(ext);
    const previewUrl = isImage ? URL.createObjectURL(file) : null;
    reqSelectedFiles.push({
      file,
      name: file.name,
      size: file.size,
      type: file.type || '',
      isImage,
      previewUrl
    });
    added++;
  }
  const previewContainer = document.getElementById('req-file-preview-list');
  if(previewContainer){
    previewContainer.innerHTML = renderReqFilesHtml();
  }
  if(added > 0){
    toast(`แนบไฟล์สำเร็จ ${added} รายการ`);
  }
}

function handleReqDragOver(e){
  e.preventDefault();
  e.stopPropagation();
  e.currentTarget.classList.add('dragover');
}

function handleReqDragLeave(e){
  e.preventDefault();
  e.stopPropagation();
  e.currentTarget.classList.remove('dragover');
}

function handleReqDrop(e){
  e.preventDefault();
  e.stopPropagation();
  e.currentTarget.classList.remove('dragover');
  if(e.dataTransfer && e.dataTransfer.files){
    handleReqFileSelect(e.dataTransfer.files);
  }
}

function handleReqFileInputChange(files){
  handleReqFileSelect(files);
  const input = document.getElementById('f-attachment-input');
  if(input) input.value = '';
}

function removeReqFile(index){
  if(reqSelectedFiles[index]){
    if(reqSelectedFiles[index].previewUrl){
      URL.revokeObjectURL(reqSelectedFiles[index].previewUrl);
    }
    reqSelectedFiles.splice(index, 1);
  }
  const previewContainer = document.getElementById('req-file-preview-list');
  if(previewContainer){
    previewContainer.innerHTML = renderReqFilesHtml();
  }
}

function showImageLightbox(url, title){
  const fullUrl = (window.Api && window.Api.fileUrl) ? window.Api.fileUrl(url) : url;
  const modal = document.createElement('div');
  modal.className = 'lightbox-modal';
  modal.onclick = ()=> modal.remove();
  modal.innerHTML = `
    <div style="text-align:center;max-width:90vw;" onclick="event.stopPropagation()">
      <img src="${fullUrl}" class="lightbox-img" alt="${esc(title||'รูปภาพ')}">
      ${title ? `<div style="color:#fff;margin-top:10px;font-size:13px;text-shadow:0 1px 4px rgba(0,0,0,0.8);">${esc(title)}</div>` : ''}
      <div style="margin-top:12px;">
        <button class="btn btn-sm" style="background:rgba(255,255,255,0.2);color:#fff;border:none;" onclick="this.closest('.lightbox-modal').remove()">ปิดหน้าต่าง [ESC]</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
}

function renderAttachmentsPreviewHtml(attachments){
  if(!attachments || !attachments.length) return '';
  return `
    <div class="req-attachments-block">
      <div class="req-attachments-title"><span>📎</span> เอกสารและรูปภาพแนบ (${attachments.length})</div>
      <div class="req-attachments-list">
        ${attachments.map(att => {
          const ext = getFileExt(att.name);
          const isImg = att.isImage || ['png','jpg','jpeg','webp','gif','bmp','svg'].includes(ext);
          const fileUrl = (window.Api && window.Api.fileUrl) ? window.Api.fileUrl(att.url) : att.url;
          const iconMeta = getFileIconMeta(att.name);
          if(isImg){
            return `
              <div class="req-att-pill" onclick="showImageLightbox('${fileUrl}', '${esc(att.name)}')" title="คลิกเพื่อดูรูปภาพขนาดใหญ่">
                <img src="${fileUrl}" class="req-att-thumb-mini" alt="${esc(att.name)}">
                <span>${esc(att.name)}</span>
                <span style="font-size:10px;color:var(--muted);">(${fmtFileSize(att.sizeBytes)})</span>
              </div>
            `;
          }
          return `
            <a href="${fileUrl}" target="_blank" download="${esc(att.name)}" class="req-att-pill" title="คลิกเพื่อดาวน์โหลด / เปิดไฟล์">
              <span class="req-att-badge-mini ${iconMeta.cls}">${iconMeta.label}</span>
              <span>${esc(att.name)}</span>
              <span style="font-size:10px;color:var(--muted);">(${fmtFileSize(att.sizeBytes)})</span>
            </a>
          `;
        }).join('')}
      </div>
    </div>
  `;
}

// Clipboard paste listener for Add Request page
window.addEventListener('paste', (e) => {
  if (currentPage !== 'add-request') return;
  const items = e.clipboardData && e.clipboardData.items;
  if (!items) return;
  const files = [];
  for (let i = 0; i < items.length; i++) {
    if (items[i].kind === 'file') {
      const file = items[i].getAsFile();
      if (file) files.push(file);
    }
  }
  if (files.length > 0) {
    handleReqFileSelect(files);
  }
});

function resetRequestForm(){
  const p = document.getElementById('f-product'); if(p) p.value = '';
  const c = document.getElementById('f-condition'); if(c) c.selectedIndex = 0;
  const s = document.getElementById('f-standard'); if(s) s.value = '';
  const q = document.getElementById('f-qty'); if(q) q.value = 1;
  const pr = document.getElementById('f-priority'); if(pr) pr.value = 'Normal';
  const rNormal = document.querySelector('input[name="priority-radio"][value="Normal"]');
  if(rNormal) rNormal.checked = true;
  const rm = document.getElementById('f-remark'); if(rm) rm.value = '';
  const fi = document.getElementById('f-attachment-input'); if(fi) fi.value = '';
  reqSelectedFiles.forEach(f => { if(f.previewUrl) URL.revokeObjectURL(f.previewUrl); });
  reqSelectedFiles = [];
  const pl = document.getElementById('req-file-preview-list'); if(pl) pl.innerHTML = '';
}

async function submitRequest(){
  const product = document.getElementById('f-product').value.trim();
  const condition = document.getElementById('f-condition').value;
  if(!product){ toast('กรุณากรอกชื่อผลิตภัณฑ์', true); return; }
  if(!db){ toast('ไม่สามารถบันทึกได้ ฐานข้อมูลไม่พร้อมใช้งาน', true); return; }

  const submitBtn = document.querySelector('.btn-submit');
  const origBtnHtml = submitBtn ? submitBtn.innerHTML : '';
  if(submitBtn){
    submitBtn.disabled = true;
  }

  try{
    const uploadedAttachments = [];
    if(reqSelectedFiles.length > 0){
      if(!assetsCap) throw new Error('ระบบอัปโหลดไฟล์ไม่พร้อมใช้งาน');
      for(let i = 0; i < reqSelectedFiles.length; i++){
        const item = reqSelectedFiles[i];
        if(submitBtn){
          submitBtn.innerHTML = `<span>⏳</span> กำลังอัปโหลด (${i + 1}/${reqSelectedFiles.length})...`;
        }
        const asset = await assetsCap.upload(item.file);
        uploadedAttachments.push({
          id: asset.id,
          name: item.name,
          url: asset.url,
          sizeBytes: asset.sizeBytes || item.size,
          type: item.type || '',
          isImage: !!item.isImage,
          uploadedAt: new Date().toISOString()
        });
      }
    }

    if(submitBtn){
      submitBtn.innerHTML = `<span>⏳</span> กำลังส่ง Request...`;
    }

    const requestNo = 'R' + new Date().toISOString().slice(2,10).replace(/-/g,'') + '-' + uid().slice(0,4).toUpperCase();
    const payload = {
      requestNo,
      productName: product,
      testCondition: condition,
      testStandard: document.getElementById('f-standard').value.trim(),
      quantity: Number(document.getElementById('f-qty').value)||1,
      priority: document.getElementById('f-priority').value,
      line: document.getElementById('f-line').value,
      department: CURRENT_USER.dept,
      requesterName: CURRENT_USER.name,
      requesterEmpId: CURRENT_USER.empId,
      remark: document.getElementById('f-remark').value.trim(),
      attachments: uploadedAttachments,
      status: 'Pending',
      chamberId: null, chamberName: null,
      startDateTime: null, endDateTime: null,
      createdAt: new Date().toISOString(),
      scheduledAt: null,
      report: null,
    };

    await db.collection('requests').add(payload);
    toast(`ส่ง Request สำเร็จ — หมายเลข ${requestNo}`);

    // Cleanup
    reqSelectedFiles.forEach(f => { if(f.previewUrl) URL.revokeObjectURL(f.previewUrl); });
    reqSelectedFiles = [];

    calSubTab = 'list';
    navigate('calendar');
  }catch(e){
    toast('บันทึกไม่สำเร็จ: '+(e.message||e), true);
  }finally{
    if(submitBtn){
      submitBtn.disabled = false;
      submitBtn.innerHTML = origBtnHtml;
    }
  }
}

/* ============================================================
   PAGE: Timeline Calculator (คำนวณระยะเวลาทดสอบ)
   ported from user-provided script.js / styles.css / index.html
   ============================================================ */
let tcStartDateGlobal = null;
let tcEndDateGlobal = null;

function pageTimelineCalc(){
  return `
  <div class="page-head"><div><h2>คำนวณระยะเวลาทดสอบ</h2><div class="sub">ระบุเครื่องและเงื่อนไข เพื่อคำนวณวัน-เวลาสิ้นสุดการทดสอบ พร้อมปฏิทินแสดงช่วงเวลาแบบเต็มจอ</div></div></div>

  <div class="tc-layout-grid">
    <!-- ฝั่งซ้าย: ตั้งค่าพารามิเตอร์และสรุปผล -->
    <div class="tc-left-col">
      <div class="card tc-calc-card">
        <div class="tc-card-title">
          <span>⚙️</span>
          <div>พารามิเตอร์การทดสอบ</div>
        </div>

        <div class="form-grid">
          <div class="full">
            <label class="form-label">เลือกเครื่องทดสอบ <span class="req-star">*</span></label>
            <select id="tc-machineType" class="form-input" onchange="tcToggleFields()">
              <option value="">-- เลือกเครื่อง --</option>
              <option value="HTS">High Temperature Storage (HTS)</option>
              <option value="THS">Temperature Humidity Storage (THS)</option>
              <option value="TMCL">Temperature Cycle (TMCL)</option>
              <option value="TS">Thermal Shock (T/S)</option>
            </select>
          </div>

          <div>
            <label class="form-label">วันที่เริ่มต้น <span class="req-star">*</span></label>
            <input type="date" id="tc-startDate" class="form-input">
          </div>
          <div>
            <label class="form-label">เวลาเริ่มต้น <span class="req-star">*</span></label>
            <input type="text" id="tc-startTime" class="form-input" placeholder="HH:MM" maxlength="5">
          </div>

          <div id="tc-manualAdd" class="full" style="display:none; grid-template-columns:1fr 1fr; gap:12px;">
            <div>
              <label class="form-label">ต้องการเพิ่ม (ชั่วโมง)</label>
              <input type="number" id="tc-addHours" class="form-input" value="0" min="0">
            </div>
            <div>
              <label class="form-label">ต้องการเพิ่ม (นาที)</label>
              <input type="number" id="tc-addMinutes" class="form-input" value="0" min="0">
            </div>
          </div>

          <div id="tc-cycleParams" class="full" style="display:none; grid-template-columns:1fr 1fr; gap:12px;">
            <div>
              <label class="form-label">อุณหภูมิด้านเย็น (Cold)</label>
              <input type="number" id="tc-coldTemp" class="form-input" step="0.1" placeholder="°C">
            </div>
            <div>
              <label class="form-label">อุณหภูมิด้านร้อน (Hot)</label>
              <input type="number" id="tc-hotTemp" class="form-input" step="0.1" placeholder="°C">
            </div>
            <div>
              <label class="form-label">Dwell time (นาที)</label>
              <input type="number" id="tc-dwell" class="form-input" min="0" step="0.1" value="0">
            </div>
            <div>
              <label class="form-label">Transfer time (นาที)</label>
              <input type="number" id="tc-transfer" class="form-input" min="0" step="0.1" value="0">
            </div>
            <div class="full">
              <label class="form-label">Cycle (รอบ)</label>
              <input type="number" id="tc-cycle" class="form-input" min="1" value="1">
            </div>
          </div>
        </div>

        <div class="tc-actions-row">
          <button class="btn btn-primary tc-btn-calc" onclick="tcCalculate()">⚡ คำนวณ</button>
          <button class="btn" onclick="tcSetCurrentTime()">ตั้งเวลาปัจจุบัน</button>
          <button class="btn" onclick="tcResetForm()">รีเซ็ต</button>
        </div>
      </div>

      <!-- สรุปผลการคำนวณ -->
      <div class="tc-result" id="tc-resultBox" style="display:none;">
        <div class="tc-result-head">
          <span style="color:var(--accent);">📊</span>
          <span>สรุปผลการคำนวณ</span>
        </div>
        <div class="tc-result-item"><span class="tc-label">วันที่-เวลาเริ่มต้น</span><span class="tc-value" id="tc-origDate"></span></div>
        <div class="tc-result-item"><span class="tc-label">ระยะเวลาที่เพิ่ม</span><span class="tc-value" id="tc-addedTime"></span></div>
        <div class="tc-result-item tc-result-highlight" id="tc-endDateRow"><span class="tc-label">วันที่-เวลาสิ้นสุด</span><span class="tc-value" id="tc-endDate"></span></div>
        <div class="tc-result-item" id="tc-conditionRow"><span class="tc-label">Condition</span><span class="tc-value" id="tc-condition"></span></div>
      </div>
    </div>

    <!-- ฝั่งขวา: ปฏิทินแสดงช่วงเวลาทดสอบ เต็มพื้นที่จอ -->
    <div class="tc-right-col">
      <div class="card tc-calendar-card-panel">
        <div class="tc-card-title">
          <span>📅</span>
          <div>
            <div style="font-weight:700;">ปฏิทินแสดงช่วงเวลาทดสอบ (Timeline Calendar)</div>
            <div style="font-size:12px;color:var(--muted);font-weight:400;margin-top:2px;">แสดงวันและเวลาเริ่มต้น-สิ้นสุดของการทดสอบบนปฏิทิน</div>
          </div>
        </div>

        <div id="tc-calendarBox" style="display:none; width:100%;">
          <div id="tc-calendarContainer"></div>
        </div>

        <div id="tc-calendarPlaceholder" class="tc-placeholder">
          <div class="tc-placeholder-icon">📆</div>
          <h4>ยังไม่มีการคำนวณระยะเวลา</h4>
          <p>เลือกประเภทเครื่องทดสอบ ระบุวันที่และเวลาเริ่มต้น จากนั้นกดปุ่ม <b>"คำนวณ"</b> เพื่อแสดงช่วงเวลาทดสอบบนปฏิทินแบบเต็มหน้าจอ</p>
        </div>
      </div>
    </div>
  </div>`;
}

function initTimelineCalc(){
  tcSetupTimeInput();
  tcToggleFields();
  const box = document.getElementById('tc-resultBox');
  if(box) box.style.display = 'none';
  const cal = document.getElementById('tc-calendarBox');
  if(cal) cal.style.display = 'none';
  const ph = document.getElementById('tc-calendarPlaceholder');
  if(ph) ph.style.display = 'flex';
}

function tcToggleFields(){
  const sel = document.getElementById('tc-machineType');
  if(!sel) return;
  const val = sel.value;
  document.getElementById('tc-manualAdd').style.display = (val && val !== 'TMCL' && val !== 'TS') ? 'grid' : 'none';
  document.getElementById('tc-cycleParams').style.display = (val === 'TMCL' || val === 'TS') ? 'grid' : 'none';
  if (val === 'TS') {
    document.getElementById('tc-transfer').value = '1';
    document.getElementById('tc-transfer').disabled = true;
  } else if (val === 'TMCL') {
    document.getElementById('tc-transfer').value = '0';
    document.getElementById('tc-transfer').disabled = false;
  }
}

function tcCalculate(){
  const machine = document.getElementById('tc-machineType').value;
  if (!machine) { toast('กรุณาเลือกเครื่อง', true); return; }

  const startDateInput = document.getElementById('tc-startDate').value;
  const timeStr = document.getElementById('tc-startTime').value || "00:00";

  if (!startDateInput) { toast('กรุณาเลือกวันที่เริ่มต้น', true); return; }

  const [yyyy, mm, dd] = startDateInput.split('-');
  const [hh, min] = timeStr.split(':').map(Number);
  tcStartDateGlobal = new Date(yyyy, mm - 1, dd, hh || 0, min || 0, 0);
  tcEndDateGlobal = new Date(tcStartDateGlobal);

  let addedHours = 0;
  let addedMinutes = 0;
  const addedDesc = '';

  if (machine === 'TMCL' || machine === 'TS') {
    const dwell = parseFloat(document.getElementById('tc-dwell').value) || 0;
    let transfer = parseFloat(document.getElementById('tc-transfer').value) || 0;

    if (machine === 'TMCL') {
      const coldTempNum = parseFloat(document.getElementById('tc-coldTemp').value) || 0;
      const hotTempNum = parseFloat(document.getElementById('tc-hotTemp').value) || 0;
      const deltaTemp = Math.abs(hotTempNum - coldTempNum);
      const minTransferTime = deltaTemp / 23;

      if (transfer < minTransferTime) {
        toast(`Transfer time ที่กำหนด (${transfer} นาที) ต่ำเกินไป — ตาม Ramp rate ของเครื่อง TMCL (23°C/นาที) ต้องใช้อย่างน้อย ${minTransferTime.toFixed(1)} นาที`, true);
        return;
      }
    }

    if (machine === 'TS') transfer = 1;
    const cycles = parseInt(document.getElementById('tc-cycle').value) || 1;

    if (cycles < 1) { toast('Cycle ต้องมากกว่าหรือเท่ากับ 1', true); return; }

    const totalAddedMin = (dwell * 2 + transfer * 2) * cycles;
    addedHours = Math.floor(totalAddedMin / 60);
    addedMinutes = totalAddedMin % 60;

    const coldTemp = document.getElementById('tc-coldTemp').value || '0';
    const hotTemp = document.getElementById('tc-hotTemp').value || '0';
    document.getElementById('tc-condition').textContent = `${coldTemp} °C / ${hotTemp} °C · Dwell ${dwell} min · Transfer ${transfer} min · Cycle ${cycles}`;
  } else {
    addedHours = parseInt(document.getElementById('tc-addHours').value) || 0;
    addedMinutes = parseInt(document.getElementById('tc-addMinutes').value) || 0;
    document.getElementById('tc-condition').textContent = '';
  }

  document.getElementById('tc-conditionRow').style.display = (machine === 'TMCL' || machine === 'TS') ? 'flex' : 'none';

  tcEndDateGlobal.setHours(tcEndDateGlobal.getHours() + addedHours);
  tcEndDateGlobal.setMinutes(tcEndDateGlobal.getMinutes() + addedMinutes);

  const days = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
  const thaiMonths = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];

  const formatThaiDate = (d) => {
    const dayNum = d.getDate();
    const month = thaiMonths[d.getMonth()];
    const year = d.getFullYear();
    const weekday = days[d.getDay()];
    const hour = String(d.getHours()).padStart(2, '0');
    const minute = String(d.getMinutes()).padStart(2, '0');
    return `${dayNum} ${month} ${year} ${hour}:${minute} (${weekday})`;
  };

  document.getElementById('tc-origDate').textContent = formatThaiDate(tcStartDateGlobal);
  document.getElementById('tc-addedTime').textContent = `${addedDesc} ${addedHours} Hours ${addedMinutes} Minutes`;
  document.getElementById('tc-endDate').textContent = formatThaiDate(tcEndDateGlobal);
  const endEl = document.getElementById('tc-endDate');
  endEl.classList.toggle('tc-end-date-red', tcEndDateGlobal.getDay() === 0);

  document.getElementById('tc-resultBox').style.display = 'block';
  document.getElementById('tc-calendarBox').style.display = 'block';
  const ph = document.getElementById('tc-calendarPlaceholder');
  if(ph) ph.style.display = 'none';

  tcGenerateCalendar(
    tcEndDateGlobal.getFullYear(),
    tcEndDateGlobal.getMonth(),
    tcStartDateGlobal,
    tcEndDateGlobal,
    String(tcStartDateGlobal.getHours()).padStart(2, '0') + ':' + String(tcStartDateGlobal.getMinutes()).padStart(2, '0'),
    String(tcEndDateGlobal.getHours()).padStart(2, '0') + ':' + String(tcEndDateGlobal.getMinutes()).padStart(2, '0')
  );
}

function tcRenderCalendarMonth(year, month, startDate, endDate, startTimeStr, endTimeStr){
  const thaiMonths = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  let html = `<div class="tc-calendar-card"><div class="tc-calendar-header">${thaiMonths[month]} ${year}</div><table>`;
  html += '<tr><th>SUN</th><th>MON</th><th>TUE</th><th>WED</th><th>THU</th><th>FRI</th><th>SAT</th></tr><tr>';
  for (let i = 0; i < firstDay; i++) html += '<td class="outside"></td>';

  for (let day = 1; day <= daysInMonth; day++) {
    const currentDate = new Date(year, month, day);
    const isStart = startDate && currentDate.toDateString() === startDate.toDateString();
    const isEnd = endDate && currentDate.toDateString() === endDate.toDateString();
    const isInRange = startDate && endDate && currentDate >= startDate && currentDate <= endDate;
    const isSunday = currentDate.getDay() === 0;

    let cellContent = `<div class="day-number ${isSunday ? 'sunday' : ''}">${day}</div>`;
    let rangeLabel = '';

    if (isStart && !isEnd) {
      cellContent = `<div class="day-number start-circle">${day}</div>`;
      cellContent += `<div class="time-label">${startTimeStr}</div>`;
      rangeLabel = `<div class="range-label">Start</div>`;
    } else if (isEnd && !isStart) {
      cellContent = `<div class="day-number end-circle">${day}</div>`;
      cellContent += `<div class="time-label">${endTimeStr}</div>`;
      rangeLabel = `<div class="range-label" style="background-color: var(--danger); color:#fff;">Finish</div>`;
    } else if (isStart && isEnd) {
      cellContent = `<div class="day-number end-circle">${day}</div>`;
      cellContent += `<div style="margin-top:4px;line-height:1.2;"><span class="range-label" style="background-color:var(--accent);color:#04141d;margin-top:0;">Start</span><div class="time-label" style="margin-top:2px;">${startTimeStr}</div></div><div style="margin-top:3px;line-height:1.2;"><span class="range-label" style="background-color:var(--danger);color:#fff;margin-top:0;">Finish</span><div class="time-label" style="margin-top:2px;">${endTimeStr}</div></div>`;
      rangeLabel = '';
    }

    let cellClass = isInRange ? 'highlight-range' : '';
    if (isStart) cellClass += ' highlight-start';
    if (isEnd) cellClass += ' highlight-end';

    html += `<td class="${cellClass.trim()}">${cellContent}${rangeLabel}</td>`;
    if ((firstDay + day) % 7 === 0) html += '</tr><tr>';
  }
  html += '</tr></table></div>';
  return html;
}

function tcGenerateCalendar(year, month, startDate, endDate, startTimeStr, endTimeStr){
  const startMonth = startDate.getMonth();
  const startYear = startDate.getFullYear();
  const endMonth = endDate.getMonth();
  const endYear = endDate.getFullYear();
  const container = document.getElementById('tc-calendarContainer');
  if(!container) return;

  if (startYear === endYear && startMonth === endMonth) {
    const singleHtml = tcRenderCalendarMonth(year, month, startDate, endDate, startTimeStr, endTimeStr);
    container.innerHTML = `<div class="tc-calendar-container tc-single">${singleHtml}</div>`;
  } else {
    const firstMonthHtml = tcRenderCalendarMonth(startYear, startMonth, startDate, endDate, startTimeStr, endTimeStr);
    const secondMonthHtml = tcRenderCalendarMonth(endYear, endMonth, startDate, endDate, startTimeStr, endTimeStr);
    container.innerHTML = `<div class="tc-calendar-container">${firstMonthHtml}${secondMonthHtml}</div>`;
  }
}

function tcSetCurrentTime(){
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const min = String(now.getMinutes()).padStart(2, '0');
  document.getElementById('tc-startDate').value = `${yyyy}-${mm}-${dd}`;
  document.getElementById('tc-startTime').value = `${hh}:${min}`;
}

function tcResetForm(){
  document.getElementById('tc-machineType').value = '';
  document.getElementById('tc-startDate').value = '';
  document.getElementById('tc-startTime').value = '';
  document.getElementById('tc-addHours').value = '0';
  document.getElementById('tc-addMinutes').value = '0';
  document.getElementById('tc-coldTemp').value = '';
  document.getElementById('tc-hotTemp').value = '';
  document.getElementById('tc-dwell').value = '0';
  document.getElementById('tc-transfer').value = '0';
  document.getElementById('tc-transfer').disabled = false;
  document.getElementById('tc-cycle').value = '1';
  tcToggleFields();
  document.getElementById('tc-resultBox').style.display = 'none';
  const cal = document.getElementById('tc-calendarBox');
  if(cal) cal.style.display = 'none';
  const ph = document.getElementById('tc-calendarPlaceholder');
  if(ph) ph.style.display = 'flex';
}

function tcSetupTimeInput(){
  const timeInput = document.getElementById('tc-startTime');
  if (!timeInput) return;
  timeInput.placeholder = 'HH:MM';
  timeInput.maxLength = 5;

  timeInput.addEventListener('input', function(e){
    let val = e.target.value.replace(/\D/g, '');
    if (val.length > 4) val = val.substring(0, 4);
    if (val.length > 2) {
      e.target.value = val.substring(0, 2) + ':' + val.substring(2);
    } else {
      e.target.value = val;
    }
  });

  timeInput.addEventListener('blur', function(e){
    let val = e.target.value;
    if (val === '') return;
    const regex = /^([01]\d|2[0-3]):([0-5]\d)$/;
    if (!regex.test(val)) {
      toast('กรุณาระบุเวลาให้ถูกต้องในรูปแบบ 24 ชั่วโมง (00:00 - 23:59) เช่น 08:30', true);
      e.target.value = '';
    }
  });
}

/* ============================================================
   PAGE: My Requests (requester)
   ============================================================ */
function statusBadge(status){
  const map = {Pending:'badge-pending', Scheduled:'badge-scheduled', Testing:'badge-testing', Completed:'badge-completed', Cancelled:'badge-cancelled'};
  return `<span class="badge ${map[status]||'badge-pending'}">${esc(status||'Pending')}</span>`;
}
/* "My Requests" is now shown in the Calendar hub's List tab, scoped to the
   current user for non-admin roles via requestsInMonth() below. */

/* ============================================================
   PAGE: All requests (admin)
   ============================================================ */
function pageAllRequests(){
  return `
  <div class="page-head"><div><h2>รายการ Request ทั้งหมด</h2><div class="sub">คลิกที่แถวเพื่อแก้ไขข้อมูลหรือแพลนงานเข้าปฏิทิน</div></div></div>
  <div class="card">
    ${REQUESTS.length===0 ? '<div class="empty">ยังไม่มี Request ในระบบ</div>' : `
    <div class="table-wrap"><table>
      <thead><tr><th>Request No.</th><th>ผู้ขอ</th><th>ผลิตภัณฑ์</th><th>Condition</th><th>สถานะ</th><th>Chamber</th><th>ช่วงทดสอบ</th><th></th></tr></thead>
      <tbody>
      ${REQUESTS.map(r=>`<tr>
        <td class="mono">
          <div style="display:flex;align-items:center;gap:6px;">
            <a href="javascript:void(0)" onclick="openRequestDetailModal('${r.id}')" style="color:var(--accent);text-decoration:none;font-weight:600;" title="คลิกดูรายละเอียด">${esc(r.requestNo)}</a>
            ${r.attachments && r.attachments.length ? `<span title="มีไฟล์/รูปภาพแนบ ${r.attachments.length} รายการ" style="font-size:11px;background:rgba(31,111,209,0.12);color:var(--accent);padding:1px 5px;border-radius:4px;display:inline-flex;align-items:center;cursor:pointer;" onclick="openRequestDetailModal('${r.id}')">📎 ${r.attachments.length}</span>` : ''}
          </div>
        </td>
        <td>${esc(r.requesterName)}<br><span style="color:var(--muted);font-size:11px;">${esc(r.department)}</span></td>
        <td>${esc(r.productName)}</td>
        <td>${esc(r.testCondition)}</td>
        <td>${statusBadge(r.status)}</td>
        <td>${esc(r.chamberName||'—')}</td>
        <td class="mono" style="font-size:11.5px;">${fmtDateTime(r.startDateTime)}<br>${fmtDateTime(r.endDateTime)}</td>
        <td style="white-space:nowrap;">
          <button class="btn btn-sm" onclick="openRequestDetailModal('${r.id}')">ดูข้อมูล</button>
          <button class="btn btn-sm btn-primary" onclick="openPlanModal('${r.id}')">แพลนงาน</button>
        </td>
      </tr>`).join('')}
      </tbody>
    </table></div>`}
  </div>`;
}

/* ============================================================
   PAGE: Dashboard
   ============================================================ */
function pageDashboard(){
  return `
  <div class="page-head"><div><h2>Dashboard เครื่องทดสอบ</h2><div class="sub">สถานะและอุณหภูมิของแต่ละเครื่องแบบ Real-time${CURRENT_USER.role==='admin' ? ' — คลิกที่เครื่องเพื่อดูข้อมูลรายละเอียด' : ''}</div></div></div>
  ${LINES.map(l=>{
    const list = chambersOfLine(l);
    return `<section class="line-section">
      <div class="line-divider">${lineTag(l)}<span>เครื่องทดสอบฝั่ง ${LINE_LABEL[l]}</span><span class="line-count">${list.length} เครื่อง</span></div>
      <div class="grid chamber-grid">${renderChamberCards(list)}</div>
    </section>`;
  }).join('')}
  <div class="legend">
    <span><span class="dot" style="background:var(--good);"></span>Running</span>
    <span><span class="dot" style="background:var(--idle);"></span>Idle</span>
    <span><span class="dot" style="background:var(--brown);"></span>Maintenance</span>
  </div>`;
}
function dueClass(iso){
  if(!iso) return '';
  const days = (new Date(iso) - new Date()) / 86400000;
  if(days < 0) return 'due-over';
  if(days <= 14) return 'due-soon';
  return 'due-ok';
}
function renderChamberCards(list){
  list = list || CHAMBERS;
  if(list.length===0) return '<div class="empty">ยังไม่มีข้อมูลเครื่องทดสอบ</div>';
  const colorMap = {running:'var(--good)', idle:'var(--idle)', maintenance:'var(--brown)'};
  const isAdmin = CURRENT_USER.role==='admin';
  return list.map(c=>{
    const temp = c.liveTemp==null ? c.setPoint : c.liveTemp;
    const st = String(c.status || 'idle').toLowerCase();
    const stLabel = st.charAt(0).toUpperCase() + st.slice(1);
    const badgeClass = st === 'running' ? 'badge-running' : st === 'maintenance' ? 'badge-maintenance' : 'badge-idle';
    return `<div class="card chamber-card ${isAdmin?'clickable':''}" data-chamber="${c.id}" ${isAdmin?`onclick="openChamberDetail('${c.id}')"`:''}>
      <div class="status-bar" style="background:${colorMap[st]||'var(--idle)'}"></div>
      <div class="chamber-head">
        <div>
          <div class="chamber-name">${esc(c.name)}</div>
          <div class="chamber-req">${c.requestNo ? 'กำลังทดสอบ: '+esc(c.requestNo) : 'ไม่มีงานทดสอบ'}</div>
        </div>
        <span class="badge ${badgeClass}">${esc(stLabel)}</span>
      </div>
      <div class="temp-readout" data-temp="${c.id}">${temp}<span class="temp-unit">°C</span></div>
      <div class="temp-set">Set point: ${c.setPoint}°C</div>
      <div class="pmcal-row">
        <span>PM ครบกำหนด: <b class="${dueClass(c.pmDueDate)}">${fmtDate(c.pmDueDate)}</b></span>
        <span>Cal ครบกำหนด: <b class="${dueClass(c.calDueDate)}">${fmtDate(c.calDueDate)}</b></span>
      </div>
      ${isAdmin?'<div class="view-hint">คลิกเพื่อดูรายละเอียดเครื่อง ›</div>':''}
    </div>`;
  }).join('');
}
function renderDashboardTemps(){
  CHAMBERS.forEach(c=>{
    const el = document.querySelector(`[data-temp="${c.id}"]`);
    if(el) el.innerHTML = `${c.liveTemp==null?c.setPoint:c.liveTemp}<span class="temp-unit">°C</span>`;
  });
}

/* ---------- chamber detail (Admin): install/price/spec, invoice, repair history ---------- */
let CHAMBER_REPAIRS = [];
let repairYearFilter = new Date().getFullYear();

async function openChamberDetail(chamberId){
  const c = CHAMBERS.find(x=>x.id===chamberId);
  if(!c) return;
  repairYearFilter = new Date().getFullYear();
  CHAMBER_REPAIRS = [];
  renderChamberDetailModal(chamberId);
  await reloadChamberRepairs(chamberId);
}

async function reloadChamberRepairs(chamberId){
  if(!db) return;
  try{
    const snap = await db.collection('chambers').doc(chamberId).collection('repairs').get();
    CHAMBER_REPAIRS = snap.docs.map(d=>({ id:d.id, ...d.data() }));
    CHAMBER_REPAIRS.sort((a,b)=> new Date(b.startDate||0) - new Date(a.startDate||0));
  }catch(e){ CHAMBER_REPAIRS = []; }
  refreshRepairListUI(chamberId);
}

function renderChamberDetailModal(chamberId){
  document.querySelectorAll('.modal-bg').forEach(m=>m.remove());
  const c = CHAMBERS.find(x=>x.id===chamberId);
  if(!c) return;
  const modal = document.createElement('div');
  modal.className = 'modal-bg';
  modal.dataset.chamberModal = chamberId;
  modal.onclick = (e)=>{ if(e.target===modal) modal.remove(); };
  modal.innerHTML = `
  <div class="modal detail-modal">
    <h3>${esc(c.name)}</h3>
    <div class="detail-tabs">
      <button class="detail-tab active" data-tab="overview" onclick="switchDetailTab('overview')">ข้อมูลเครื่อง</button>
      <button class="detail-tab" data-tab="invoice" onclick="switchDetailTab('invoice')">เอกสาร Invoice</button>
      <button class="detail-tab" data-tab="repair" onclick="switchDetailTab('repair')">ประวัติการซ่อม</button>
    </div>

    <div class="detail-pane active" data-pane="overview">
      <div class="form-grid">
        <div><label style="font-size:12.5px;color:var(--muted);">วันที่ติดตั้ง</label><input type="date" id="dt-install" value="${c.installDate ? c.installDate.slice(0,10) : ''}" style="width:100%;"></div>
        <div><label style="font-size:12.5px;color:var(--muted);">ราคาเครื่อง (บาท)</label><input type="number" id="dt-price" value="${c.price!=null?c.price:''}" style="width:100%;"></div>
        <div><label style="font-size:12.5px;color:var(--muted);">PM ครบกำหนดวันที่</label><input type="date" id="dt-pm" value="${c.pmDueDate ? c.pmDueDate.slice(0,10) : ''}" style="width:100%;"></div>
        <div><label style="font-size:12.5px;color:var(--muted);">Calibration ครบกำหนดวันที่</label><input type="date" id="dt-cal" value="${c.calDueDate ? c.calDueDate.slice(0,10) : ''}" style="width:100%;"></div>
        <div class="full"><label style="font-size:12.5px;color:var(--muted);">สเปคเครื่อง</label><textarea id="dt-spec" rows="4" style="width:100%;">${esc(c.specText||'')}</textarea></div>
      </div>
      <div class="modal-actions"><button class="btn btn-primary" onclick="saveChamberDetail('${c.id}')">บันทึกข้อมูลเครื่อง</button></div>
    </div>

    <div class="detail-pane" data-pane="invoice">
      <div class="invoice-box">
        <div>
          <div style="font-weight:600;font-size:13px;">${c.invoiceFileName ? esc(c.invoiceFileName) : 'ยังไม่มีเอกสาร Invoice'}</div>
          <div style="font-size:11.5px;color:var(--muted);margin-top:2px;">${c.invoiceUploadedAt ? 'อัปโหลดเมื่อ '+fmtDateTime(c.invoiceUploadedAt) : 'อัปโหลดไฟล์ใบแจ้งหนี้ (PDF/รูปภาพ) ของเครื่องนี้'}</div>
        </div>
        ${c.invoiceAssetId ? `<button class="btn btn-sm" onclick="window.open(Api.fileUrl('${c.invoiceUrl}'),'_blank')">ดาวน์โหลด</button>` : ''}
      </div>
      <div style="margin-top:14px;">
        <label style="font-size:12.5px;color:var(--muted);">อัปโหลดไฟล์ใหม่ (แทนที่ไฟล์เดิม)</label><br>
        <input type="file" id="dt-invoice-file" accept=".pdf,.png,.jpg,.jpeg,.webp" style="margin-top:6px;">
      </div>
      <div class="modal-actions"><button class="btn btn-primary" onclick="uploadInvoice('${c.id}')">อัปโหลด</button></div>
    </div>

    <div class="detail-pane" data-pane="repair">
      <div style="display:flex; align-items:center; gap:10px; margin-bottom:12px;">
        <label style="font-size:12.5px;color:var(--muted);">ปี</label>
        <select id="repair-year" onchange="repairYearFilter=Number(this.value); refreshRepairListUI('${c.id}')" style="width:110px;">
          ${yearOptions()}
        </select>
      </div>
      <div id="repair-list"></div>
      <div style="border-top:1px solid var(--border); margin-top:14px; padding-top:14px;">
        <div style="font-weight:700;font-size:13px;margin-bottom:10px;">+ เพิ่มบันทึกการซ่อม</div>
        <div class="form-grid">
          <div><label style="font-size:12.5px;color:var(--muted);">ซ่อมวันที่ (เริ่ม)</label><input type="date" id="rp-start" style="width:100%;"></div>
          <div><label style="font-size:12.5px;color:var(--muted);">ถึงวันที่ (เสร็จ)</label><input type="date" id="rp-end" style="width:100%;"></div>
          <div><label style="font-size:12.5px;color:var(--muted);">ค่าใช้จ่าย (บาท)</label><input type="number" id="rp-cost" style="width:100%;"></div>
          <div class="full"><label style="font-size:12.5px;color:var(--muted);">รายละเอียดการซ่อม</label><textarea id="rp-detail" rows="3" style="width:100%;"></textarea></div>
        </div>
        <button class="btn btn-primary" style="margin-top:10px;" onclick="addRepairRecord('${c.id}')">บันทึกการซ่อม</button>
      </div>
    </div>

    <div class="modal-actions"><button class="btn" onclick="this.closest('.modal-bg').remove()">ปิด</button></div>
  </div>`;
  document.body.appendChild(modal);
  refreshRepairListUI(chamberId);
}

function yearOptions(){
  const now = new Date().getFullYear();
  let opts = '';
  for(let y=now; y>=now-6; y--) opts += `<option value="${y}" ${y===repairYearFilter?'selected':''}>${y+543}</option>`;
  return opts;
}

function switchDetailTab(tab){
  document.querySelectorAll('.detail-tab').forEach(b=>b.classList.toggle('active', b.dataset.tab===tab));
  document.querySelectorAll('.detail-pane').forEach(p=>p.classList.toggle('active', p.dataset.pane===tab));
}

async function saveChamberDetail(chamberId){
  if(!db) return;
  const install = document.getElementById('dt-install').value;
  const price = document.getElementById('dt-price').value;
  const pm = document.getElementById('dt-pm').value;
  const cal = document.getElementById('dt-cal').value;
  const spec = document.getElementById('dt-spec').value.trim();
  try{
    await db.collection('chambers').doc(chamberId).update({
      installDate: install ? new Date(install).toISOString() : null,
      price: price ? Number(price) : null,
      pmDueDate: pm ? new Date(pm).toISOString() : null,
      calDueDate: cal ? new Date(cal).toISOString() : null,
      specText: spec,
    });
    toast('บันทึกข้อมูลเครื่องแล้ว');
  }catch(e){ toast('บันทึกไม่สำเร็จ: '+(e.message||e), true); }
}

async function uploadInvoice(chamberId){
  const fileInput = document.getElementById('dt-invoice-file');
  const file = fileInput.files[0];
  if(!file){ toast('กรุณาเลือกไฟล์ก่อนอัปโหลด', true); return; }
  if(!assetsCap){ toast('ไม่สามารถอัปโหลดไฟล์ได้ในมุมมองนี้', true); return; }
  try{
    const asset = await assetsCap.upload(file);
    await db.collection('chambers').doc(chamberId).update({
      invoiceAssetId: asset.id,
      invoiceUrl: asset.url,
      invoiceFileName: file.name,
      invoiceUploadedAt: new Date().toISOString(),
    });
    toast('อัปโหลด Invoice สำเร็จ');
    renderChamberDetailModal(chamberId);
    switchDetailTab('invoice');
  }catch(e){ toast('อัปโหลดไม่สำเร็จ: '+(e && e.message || e), true); }
}

function refreshRepairListUI(chamberId){
  const root = document.getElementById('repair-list');
  if(!root) return;
  const filtered = CHAMBER_REPAIRS.filter(r=> r.startDate && new Date(r.startDate).getFullYear()===repairYearFilter);
  if(filtered.length===0){ root.innerHTML = '<div class="empty">ไม่มีประวัติการซ่อมในปีนี้</div>'; return; }
  root.innerHTML = filtered.map(r=>`
    <div class="repair-row">
      <div style="display:flex;justify-content:space-between;">
        <b class="mono">${fmtDate(r.startDate)} → ${fmtDate(r.endDate)}</b>
        <span class="mono">${r.cost!=null ? Number(r.cost).toLocaleString('th-TH')+' บาท' : '—'}</span>
      </div>
      <div class="repair-meta">${esc(r.details||'-')}</div>
      <button class="btn btn-sm btn-danger" style="margin-top:8px;" onclick="deleteRepairRecord('${chamberId}','${r.id}')">ลบ</button>
    </div>`).join('');
}

async function addRepairRecord(chamberId){
  if(!db) return;
  const start = document.getElementById('rp-start').value;
  const end = document.getElementById('rp-end').value;
  const cost = document.getElementById('rp-cost').value;
  const details = document.getElementById('rp-detail').value.trim();
  if(!start){ toast('กรุณาระบุวันที่เริ่มซ่อม', true); return; }
  try{
    await db.collection('chambers').doc(chamberId).collection('repairs').add({
      startDate: new Date(start).toISOString(),
      endDate: end ? new Date(end).toISOString() : null,
      cost: cost ? Number(cost) : null,
      details,
      createdAt: new Date().toISOString(),
    });
    toast('บันทึกการซ่อมแล้ว');
    document.getElementById('rp-start').value='';
    document.getElementById('rp-end').value='';
    document.getElementById('rp-cost').value='';
    document.getElementById('rp-detail').value='';
    await reloadChamberRepairs(chamberId);
  }catch(e){ toast('บันทึกไม่สำเร็จ: '+(e.message||e), true); }
}
async function deleteRepairRecord(chamberId, repairId){
  if(!db) return;
  if(!confirm('ยืนยันลบบันทึกการซ่อมนี้?')) return;
  try{
    await db.collection('chambers').doc(chamberId).collection('repairs').doc(repairId).delete();
    toast('ลบแล้ว');
    await reloadChamberRepairs(chamberId);
  }catch(e){ toast('ลบไม่สำเร็จ', true); }
}

/* ============================================================
   PAGE: Calendar
   ============================================================ */
function switchCalSubTab(tab){ calSubTab = tab; render(); }

function boardStatusOf(r){
  if(r.status==='Testing') return 'inprogress';
  if(r.status==='Completed' || r.status==='Cancelled') return 'done';
  return 'todo'; // Pending, Scheduled
}
function relStatusBadge(conclusion){
  const map = {Pass:'badge-completed', Fail:'badge-cancelled', 'Conditional Pass':'badge-pending'};
  return `<span class="badge ${map[conclusion]||'badge-scheduled'}">${esc(conclusion)}</span>`;
}

function pageCalendarHub(){
  return `
  <div class="page-head"><div><h2>ตารางแพลนงาน</h2><div class="sub">List, Board, Calendar และ Summary ของงานทดสอบ — เลือกฝั่ง LPN ที่ต้องการดู</div></div></div>
  ${lineSwitchHtml(calLine, 'calLine', false)}
  <div class="detail-tabs">
    <button class="detail-tab ${calSubTab==='list'?'active':''}" onclick="switchCalSubTab('list')">List</button>
    <button class="detail-tab ${calSubTab==='board'?'active':''}" onclick="switchCalSubTab('board')">Board</button>
    <button class="detail-tab ${calSubTab==='calendar'?'active':''}" onclick="switchCalSubTab('calendar')">Calendar</button>
    <button class="detail-tab ${calSubTab==='summary'?'active':''}" onclick="switchCalSubTab('summary')">Summary</button>
  </div>
  ${calSubTab==='list' ? calListView() : calSubTab==='board' ? calBoardView() : calSubTab==='calendar' ? calCalendarView() : calSummaryView()}
  `;
}

/* ---------- List sub-tab ---------- */
function planShift(n){ planRefDate = new Date(planRefDate.getFullYear(), planRefDate.getMonth()+n, 1); render(); }
function planToday(){ planRefDate = new Date(); render(); }
function planSetMonth(v){
  if(!v) return;
  const [y,m] = v.split('-').map(Number);
  if(!y || !m) return;
  planRefDate = new Date(y, m-1, 1);
  render();
}

/* shared month controls: same UI in List / Board / Calendar / Summary */
function monthControlsHtml(){
  const y = planRefDate.getFullYear(), m = planRefDate.getMonth();
  return `<input type="month" value="${y}-${pad(m+1)}" onchange="planSetMonth(this.value)" title="เลือกเดือนที่ต้องการดู" style="width:auto;">
    <button class="btn btn-sm" onclick="planShift(-1)">‹ ก่อนหน้า</button>
    <button class="btn btn-sm" onclick="planToday()">เดือนนี้</button>
    <button class="btn btn-sm" onclick="planShift(1)">ถัดไป ›</button>`;
}
function monthNavBar(extraHtml){
  const label = `${THAI_MONTHS[planRefDate.getMonth()]} ${planRefDate.getFullYear()+543}`;
  return `<div class="cal-head">
    <div style="font-weight:700;font-size:16px;">${label}</div>
    <div class="cal-nav">${extraHtml||''}${monthControlsHtml()}</div>
  </div>`;
}

function requestsInMonth(refDate){
  const year = refDate.getFullYear(), month = refDate.getMonth();
  return filterByLine(REQUESTS, calLine).filter(r=>{
    if(!r.createdAt) return false;
    const d = new Date(r.createdAt);
    return d.getFullYear()===year && d.getMonth()===month;
  }).sort((a,b)=> new Date(b.createdAt)-new Date(a.createdAt));
}

function calListView(){
  const isAdmin = CURRENT_USER.role==='admin';
  let inMonth = requestsInMonth(planRefDate);
  if(!isAdmin) inMonth = inMonth.filter(r=>r.requesterEmpId===CURRENT_USER.empId);
  return `
  <div class="card">
    ${!isAdmin ? `<div style="font-size:12.5px;color:var(--muted);margin-bottom:10px;">แสดงเฉพาะ Request ของคุณ (${esc(CURRENT_USER.name)})</div>` : ''}
    ${monthNavBar()}
    ${inMonth.length===0 ? `<div class="empty">${isAdmin?'ไม่มี Request ในเดือนนี้':'คุณยังไม่มี Request ในเดือนนี้ — ไปที่ "Add New Request" เพื่อเริ่มต้น'}</div>` : `
    <div class="table-wrap"><table>
      <thead><tr><th>Request No.</th><th>Requester</th><th>Priority</th><th>Status</th><th>Request date</th><th>Receive date</th><th>Rel. Status</th></tr></thead>
      <tbody>
      ${inMonth.map(r=>`<tr style="cursor:pointer;" onclick="openRequestDetailModal('${r.id}')" title="คลิกเพื่อดูรายละเอียดและไฟล์แนบ">
        <td class="mono">
          <div style="display:flex;align-items:center;gap:6px;">
            <span style="font-weight:600;color:var(--accent);">${esc(r.requestNo)}</span>
            ${r.attachments && r.attachments.length ? `<span title="มีไฟล์/รูปภาพแนบ ${r.attachments.length} รายการ" style="font-size:11px;background:rgba(31,111,209,0.12);color:var(--accent);padding:1px 5px;border-radius:4px;display:inline-flex;align-items:center;">📎 ${r.attachments.length}</span>` : ''}
          </div>
        </td>
        <td>${esc(r.requesterName)}</td>
        <td>${esc(r.priority||'Normal')}</td>
        <td>${statusBadge(r.status)}</td>
        <td class="mono">${fmtDate(r.createdAt)}</td>
        <td class="mono">${r.scheduledAt ? fmtDate(r.scheduledAt) : '—'}</td>
        <td>${r.report && r.report.conclusion ? relStatusBadge(r.report.conclusion) : '<span style="color:var(--muted);">—</span>'}</td>
      </tr>`).join('')}
      </tbody>
    </table></div>`}
  </div>`;
}

/* ---------- Board sub-tab ---------- */
function calBoardView(){
  const isAdmin = CURRENT_USER.role==='admin';
  const cols = [
    {key:'todo', label:'To Do', color:'var(--warn)'},
    {key:'inprogress', label:'In Progress', color:'var(--accent2)'},
    {key:'done', label:'Done', color:'var(--good)'},
  ];
  const grouped = {todo:[], inprogress:[], done:[]};
  requestsInMonth(planRefDate).forEach(r=> grouped[boardStatusOf(r)].push(r));

  return `<div class="card" style="margin-bottom:16px;">${monthNavBar()}</div>
  <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(240px,1fr)); align-items:start;">
    ${cols.map(col=>`
      <div class="card" style="padding:14px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
          <div style="font-weight:700;font-size:13px;"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${col.color};margin-right:6px;"></span>${col.label}</div>
          <span class="badge" style="background:var(--panel2);border:1px solid var(--border);color:var(--muted);">${grouped[col.key].length}</span>
        </div>
        <div style="display:flex;flex-direction:column;gap:8px; max-height:65vh; overflow-y:auto;">
        ${grouped[col.key].length===0 ? '<div class="empty" style="padding:14px 0;">ไม่มีงาน</div>' : grouped[col.key].map(r=>`
          <div style="border:1px solid var(--border);border-radius:8px;padding:10px 12px;background:var(--panel2);cursor:pointer;" onclick="${isAdmin ? `openPlanModal('${r.id}')` : `openRequestDetailModal('${r.id}')`}">
            <div style="display:flex;justify-content:space-between;align-items:center;">
              <div class="mono" style="font-weight:700;font-size:12.5px;">${esc(r.requestNo)}</div>
              ${r.attachments && r.attachments.length ? `<span title="มีไฟล์/รูปภาพแนบ ${r.attachments.length} รายการ" style="font-size:10.5px;color:var(--accent);background:rgba(31,111,209,0.1);padding:1px 5px;border-radius:4px;">📎 ${r.attachments.length}</span>` : ''}
            </div>
            <div style="font-size:11.5px;color:var(--muted);margin-top:3px;">${esc(r.productName)}</div>
            <div style="font-size:10.5px;color:var(--muted);margin-top:5px;">${esc(r.requesterName)} · ${esc(r.priority||'Normal')}${r.chamberName?' · '+esc(r.chamberName):''}</div>
          </div>`).join('')}
        </div>
      </div>`).join('')}
  </div>`;
}

/* ---------- Calendar sub-tab ---------- */
function calCalendarView(){
  const isAdmin = CURRENT_USER.role==='admin';

  if(isAdmin){
    const adminSel = `<select onchange="calAdminChamber=this.value||null; render();" style="width:auto;">
            <option value="">-- เลือก Chamber --</option>
            <option value="all" ${calAdminChamber==='all'?'selected':''}>ทุก Chamber (${LINE_LABEL[calLine]})</option>
            ${chambersOfLine(calLine).map(c=>`<option value="${c.id}" ${calAdminChamber===c.id?'selected':''}>${esc(c.name)}</option>`).join('')}
          </select>`;
    return `
    <div class="card">
      ${monthNavBar(adminSel)}
      ${calAdminChamber ? calRenderMonthGrid(calAdminChamber) : '<div class="empty" style="padding:50px 10px;">กรุณาเลือก Chamber ก่อน เพื่อแสดงตารางแพลนงานของเครื่องนั้น</div>'}
      ${calAdminChamber ? `<div class="legend"><span><span class="dot" style="background:var(--accent);"></span>งานของผู้อื่น</span><span><span class="dot" style="background:var(--accent2);"></span>งานของฉัน</span></div>` : ''}
    </div>`;
  }

  const reqSel = `<select onchange="calChamberFilter=this.value; render();" style="width:auto;">
          <option value="all" ${calChamberFilter==='all'?'selected':''}>ทุกเครื่อง (${LINE_LABEL[calLine]})</option>
          ${chambersOfLine(calLine).map(c=>`<option value="${c.id}" ${calChamberFilter===c.id?'selected':''}>${esc(c.name)}</option>`).join('')}
        </select>`;
  return `
  <div class="card">
    ${monthNavBar(reqSel)}
    ${calRenderMonthGrid(calChamberFilter)}
    <div class="legend"><span><span class="dot" style="background:var(--accent);"></span>งานของผู้อื่น</span><span><span class="dot" style="background:var(--accent2);"></span>งานของฉัน</span></div>
  </div>`;
}

function calRenderMonthGrid(chamberFilterValue){
  const year = planRefDate.getFullYear(), month = planRefDate.getMonth();
  const firstDay = new Date(year, month, 1);
  const startOffset = firstDay.getDay();
  const daysInMonth = new Date(year, month+1, 0).getDate();
  const daysInPrevMonth = new Date(year, month, 0).getDate();
  const todayStr = new Date().toDateString();

  const cells = [];
  for(let i=startOffset-1; i>=0; i--) cells.push({d: daysInPrevMonth-i, other:true, date:new Date(year, month-1, daysInPrevMonth-i)});
  for(let d=1; d<=daysInMonth; d++) cells.push({d, other:false, date:new Date(year, month, d)});
  while(cells.length % 7 !== 0) { const n = cells.length - (startOffset+daysInMonth); cells.push({d:n+1, other:true, date:new Date(year, month+1, n+1)}); }

  const isAdmin = CURRENT_USER.role==='admin';
  const dow = ['อา','จ','อ','พ','พฤ','ศ','ส'];
  const dayMs = 86400000;
  const truncDay = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffDays = (a,b) => Math.round((a-b)/dayMs);
  const fmtHM = iso => { const d = new Date(iso); return pad(d.getHours())+':'+pad(d.getMinutes()); };

  const weeks = [];
  for(let i=0; i<cells.length; i+=7) weeks.push(cells.slice(i,i+7));

  const weeksHtml = weeks.map(week=>{
    const weekStart = truncDay(week[0].date);
    const weekEnd = new Date(weekStart.getTime() + 7*dayMs);

    const evts = filterByLine(REQUESTS, calLine).filter(r=>{
      if(!r.startDateTime) return false;
      if(chamberFilterValue!=='all' && r.chamberId!==chamberFilterValue) return false;
      const sDay = truncDay(new Date(r.startDateTime));
      const eDay = truncDay(new Date(r.endDateTime || r.startDateTime));
      return sDay < weekEnd && eDay >= weekStart;
    }).map(r=>{
      const sDay = truncDay(new Date(r.startDateTime));
      const eDay = truncDay(new Date(r.endDateTime || r.startDateTime));
      const rawStartCol = diffDays(sDay, weekStart);
      const rawEndCol = diffDays(eDay, weekStart);
      return {
        r,
        startCol: Math.max(0, rawStartCol),
        endCol: Math.min(6, rawEndCol),
        isStartHere: rawStartCol>=0 && rawStartCol<=6,
        isEndHere: rawEndCol>=0 && rawEndCol<=6,
      };
    }).sort((a,b)=> a.startCol-b.startCol || (b.endCol-b.startCol)-(a.endCol-a.startCol));

    const laneEnds = [];
    evts.forEach(evt=>{
      let lane = laneEnds.findIndex(end => end < evt.startCol);
      if(lane === -1){ lane = laneEnds.length; laneEnds.push(evt.endCol); }
      else { laneEnds[lane] = evt.endCol; }
      evt.lane = lane;
    });
    const maxLanes = Math.max(1, laneEnds.length);

    const cellsHtml = week.map((c,ci)=>{
      const isToday = c.date.toDateString()===todayStr;
      return `<div class="cal-cell ${c.other?'other-month':''} ${isToday?'today':''}" style="grid-column:${ci+1};" onclick="openDayModal('${c.date.toISOString()}')">
        <div class="cal-date">${c.d}</div>
      </div>`;
    }).join('');

    const barsHtml = evts.map(evt=>{
      const r = evt.r;
      const mine = r.requesterEmpId===CURRENT_USER.empId ? 'mine' : '';
      const roundL = evt.isStartHere ? 'round-l' : '';
      const roundR = evt.isEndHere ? 'round-r' : '';
      const parts = [];
      if(evt.isStartHere) parts.push(fmtHM(r.startDateTime));
      parts.push(r.requestNo);
      if(evt.isEndHere) parts.push(fmtHM(r.endDateTime || r.startDateTime));
      const label = parts.join(' · ');
      const tip = `${r.requestNo} · ${r.chamberName||''} · ${fmtDateTime(r.startDateTime)} → ${fmtDateTime(r.endDateTime)}`;
      return `<div class="cal-bar ${mine} ${roundL} ${roundR}" title="${esc(tip)}"
        style="grid-column:${evt.startCol+1} / ${evt.endCol+2}; grid-row:${evt.lane+2};"
        onclick="event.stopPropagation(); ${isAdmin? `openPlanModal('${r.id}')` : `openDayModal('${new Date(weekStart.getTime()+evt.startCol*dayMs).toISOString()}')`}">${esc(label)}</div>`;
    }).join('');

    return `<div class="cal-week" style="grid-template-rows:26px repeat(${maxLanes},20px);">${cellsHtml}${barsHtml}</div>`;
  }).join('');

  return `
    <div class="cal-grid" style="margin-bottom:2px;">
      ${dow.map(d=>`<div class="cal-dow">${d}</div>`).join('')}
    </div>
    ${weeksHtml}`;
}

/* ---------- Summary sub-tab ---------- */
function buildDonutChart(segments, centerLabel){
  const total = segments.reduce((s,x)=>s+x.count,0);
  const size = 180, cx = size/2, cy = size/2, r = 70, strokeW = 22;
  const circumference = 2*Math.PI*r;
  const gap = total>0 ? 3 : 0; // small visual gap between segments (px of arc)
  let offset = 0;
  const active = segments.filter(s=>s.count>0);
  const arcsHtml = active.map(s=>{
    const rawLen = (s.count/total)*circumference;
    const len = Math.max(0, rawLen - gap);
    const dasharray = `${len} ${circumference-len}`;
    const dashoffset = -offset;
    offset += rawLen;
    return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${s.color}" stroke-width="${strokeW}" stroke-dasharray="${dasharray}" stroke-dashoffset="${dashoffset}" transform="rotate(-90 ${cx} ${cy})" stroke-linecap="round"/>`;
  }).join('');
  const bgRing = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--border)" stroke-width="${strokeW}"/>`;

  const legendHtml = segments.map(s=>`
    <div style="display:flex;align-items:center;gap:9px;font-size:13px;margin-bottom:10px;">
      <span style="width:13px;height:13px;border-radius:3px;background:${s.color};flex-shrink:0;"></span>
      <span style="color:var(--text);">${esc(s.label)}: <span class="mono" style="font-weight:700;">${s.count}</span></span>
    </div>`).join('');

  return `
  <div style="display:flex; align-items:center; gap:32px; flex-wrap:wrap;">
    <div style="position:relative; width:${size}px; height:${size}px; flex-shrink:0;">
      <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${total>0?bgRing:bgRing}${arcsHtml}</svg>
      <div style="position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; text-align:center; pointer-events:none;">
        <div style="font-size:30px;font-weight:700;line-height:1;">${total}</div>
        <div style="font-size:10.5px;color:var(--muted);max-width:100px;margin-top:6px;line-height:1.3;">${esc(centerLabel)}</div>
      </div>
    </div>
    <div>${legendHtml || '<div class="empty" style="padding:0;">ไม่มีข้อมูลในเดือนนี้</div>'}</div>
  </div>`;
}

function calSummaryView(){
  const inMonth = requestsInMonth(planRefDate);
  const grouped = {todo:0, inprogress:0, done:0};
  inMonth.forEach(r=> grouped[boardStatusOf(r)]++);

  return `
  <div class="card" style="margin-bottom:18px;">
    ${monthNavBar()}
    <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(160px,1fr));">
      <div class="kpi-stat"><div class="num">${inMonth.length}</div><div class="lbl">Request ทั้งหมดในเดือนนี้</div></div>
      <div class="kpi-stat"><div class="num" style="color:var(--warn);">${grouped.todo}</div><div class="lbl">To Do</div></div>
      <div class="kpi-stat"><div class="num" style="color:var(--accent2);">${grouped.inprogress}</div><div class="lbl">In Progress</div></div>
      <div class="kpi-stat"><div class="num" style="color:var(--good);">${grouped.done}</div><div class="lbl">Done</div></div>
    </div>
  </div>

  <div class="card">
    <div style="font-weight:700;margin-bottom:16px;">Status Overview</div>
    ${buildDonutChart([
      {label:'To Do', count:grouped.todo, color:'var(--warn)'},
      {label:'In Progress', count:grouped.inprogress, color:'var(--accent2)'},
      {label:'Done', count:grouped.done, color:'var(--good)'},
    ], 'Total work items')}
  </div>`;
}


function openDayModal(isoDate){
  const day = new Date(isoDate);
  const dayStart = new Date(day.getFullYear(), day.getMonth(), day.getDate());
  const dayEnd = new Date(dayStart.getTime()+86400000);
  const isAdmin = CURRENT_USER.role==='admin';
  const effectiveFilter = isAdmin ? (calAdminChamber || 'all') : calChamberFilter;
  const evts = filterByLine(REQUESTS, calLine).filter(r=>{ if(!r.startDateTime) return false; if(effectiveFilter!=='all' && r.chamberId!==effectiveFilter) return false; const s=new Date(r.startDateTime); return s>=dayStart && s<dayEnd; });
  const pending = REQUESTS.filter(r=>!r.chamberId || r.status==='Pending');

  const modal = document.createElement('div');
  modal.className = 'modal-bg';
  modal.onclick = (e)=>{ if(e.target===modal) modal.remove(); };
  modal.innerHTML = `
  <div class="modal">
    <h3>${fmtDate(dayStart.toISOString())}</h3>
    ${evts.length===0 ? '<div class="empty" style="padding:14px 0;">ไม่มีงานทดสอบในวันนี้</div>' : evts.map(e=>`
      <div style="border:1px solid var(--border);border-radius:8px;padding:10px 12px;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center;">
        <div>
          <div class="mono" style="font-weight:600;">${esc(e.requestNo)} ${statusBadge(e.status)}</div>
          <div style="font-size:12px;color:var(--muted);margin-top:3px;">${esc(e.productName)} · ${esc(e.testCondition)} · ${esc(e.chamberName||'-')}</div>
          <div style="font-size:11.5px;color:var(--muted);" class="mono">${fmtDateTime(e.startDateTime)} → ${fmtDateTime(e.endDateTime)}</div>
        </div>
        ${isAdmin ? `<button class="btn btn-sm" onclick="document.querySelector('.modal-bg').remove(); openPlanModal('${e.id}');">แก้ไข</button>` : ''}
      </div>`).join('')}
    ${isAdmin ? `<div style="margin-top:14px;border-top:1px solid var(--border);padding-top:14px;">
      <label style="font-size:12.5px;color:var(--muted);">เลือก Request ที่จะแพลนเข้าวันนี้</label>
      <select id="day-pick-request" style="width:100%;margin-top:6px;">
        <option value="">— เลือก Request —</option>
        ${pending.map(r=>`<option value="${r.id}">${esc(r.requestNo)} — ${esc(r.productName)}</option>`).join('')}
      </select>
      <button class="btn btn-primary" style="margin-top:10px;width:100%;" onclick="const v=document.getElementById('day-pick-request').value; if(v){document.querySelector('.modal-bg').remove(); openPlanModal(v,'${dayStart.toISOString()}');}">+ แพลนงานวันนี้</button>
    </div>` : ''}
    <div class="modal-actions"><button class="btn" onclick="this.closest('.modal-bg').remove()">ปิด</button></div>
  </div>`;
  document.body.appendChild(modal);
}

/* ---------- plan modal (admin: assign chamber + schedule) ---------- */
function openPlanModal(requestId, presetDateIso){
  const r = REQUESTS.find(x=>x.id===requestId);
  if(!r){ toast('ไม่พบ Request', true); return; }
  const base = presetDateIso ? new Date(presetDateIso) : (r.startDateTime ? new Date(r.startDateTime) : new Date());
  const defStart = r.startDateTime || `${base.getFullYear()}-${pad(base.getMonth()+1)}-${pad(base.getDate())}T09:00`;
  const endBase = r.endDateTime ? new Date(r.endDateTime) : new Date(base.getTime()+8*3600000);
  const defEnd = r.endDateTime || `${endBase.getFullYear()}-${pad(endBase.getMonth()+1)}-${pad(endBase.getDate())}T17:00`;

  const modal = document.createElement('div');
  modal.className = 'modal-bg';
  modal.onclick = (e)=>{ if(e.target===modal) modal.remove(); };
  modal.innerHTML = `
  <div class="modal">
    <h3>แพลนงาน — ${esc(r.requestNo)}</h3>
    <div style="font-size:12.5px;color:var(--muted);margin-bottom:12px;">${esc(r.productName)} · ${esc(r.testCondition)} · ผู้ขอ: ${esc(r.requesterName)} (${esc(r.department||'-')})</div>

    ${r.remark ? `<div style="background:var(--panel2);border:1px solid var(--border);border-radius:8px;padding:9px 12px;font-size:12px;margin-bottom:12px;line-height:1.5;"><b style="color:var(--text);">หมายเหตุจากผู้ขอ:</b> <span style="color:var(--muted);">${esc(r.remark)}</span></div>` : ''}

    ${renderAttachmentsPreviewHtml(r.attachments)}

    <div class="form-grid" style="margin-top:14px;">
      <div class="full">
        <label style="font-size:12.5px;color:var(--muted);">Chamber</label>
        <select id="plan-chamber" style="width:100%;">
          <option value="">— เลือก Chamber —</option>
          ${LINES.map(l=>`<optgroup label="${LINE_LABEL[l]}">${chambersOfLine(l).map(c=>`<option value="${c.id}" ${r.chamberId===c.id?'selected':''}>${esc(c.name)}</option>`).join('')}</optgroup>`).join('')}
        </select>
      </div>
      <div>
        <label style="font-size:12.5px;color:var(--muted);">เริ่มทดสอบ</label>
        <input type="datetime-local" id="plan-start" style="width:100%;" value="${defStart.slice ? defStart.slice(0,16) : defStart}">
      </div>
      <div>
        <label style="font-size:12.5px;color:var(--muted);">สิ้นสุดทดสอบ</label>
        <input type="datetime-local" id="plan-end" style="width:100%;" value="${defEnd.slice ? defEnd.slice(0,16) : defEnd}">
      </div>
      <div class="full">
        <label style="font-size:12.5px;color:var(--muted);">สถานะ</label>
        <select id="plan-status" style="width:100%;">
          ${['Pending','Scheduled','Testing','Completed','Cancelled'].map(s=>`<option ${r.status===s?'selected':''}>${s}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="modal-actions">
      <button class="btn btn-danger" onclick="deleteRequest('${r.id}'); this.closest('.modal-bg').remove();">ลบ Request</button>
      <button class="btn" onclick="this.closest('.modal-bg').remove()">ยกเลิก</button>
      <button class="btn btn-primary" onclick="savePlan('${r.id}')">บันทึก</button>
    </div>
  </div>`;
  document.body.appendChild(modal);
}

/* ---------- Request Detail Modal (View remark, attachments & info) ---------- */
function openRequestDetailModal(requestId){
  const r = REQUESTS.find(x => x.id === requestId);
  if(!r){ toast('ไม่พบข้อมูล Request', true); return; }
  const isAdmin = CURRENT_USER && CURRENT_USER.role === 'admin';

  const modal = document.createElement('div');
  modal.className = 'modal-bg';
  modal.onclick = (e)=>{ if(e.target === modal) modal.remove(); };
  
  modal.innerHTML = `
  <div class="modal" style="max-width:620px;">
    <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:14px; border-bottom:1px solid var(--border); padding-bottom:12px;">
      <div>
        <div style="display:flex; align-items:center; gap:8px;">
          <h3 style="margin:0;" class="mono">${esc(r.requestNo)}</h3>
          ${statusBadge(r.status)}
          <span class="badge ${r.priority==='Urgent'?'badge-cancelled':'badge-idle'}">${esc(r.priority||'Normal')}</span>
        </div>
        <div style="font-size:12px; color:var(--muted); margin-top:4px;">
          สร้างเมื่อ ${fmtDateTime(r.createdAt)} · ฝั่ง: <b>${LINE_LABEL[r.line]||r.line||'-'}</b>
        </div>
      </div>
      <button class="btn btn-sm" onclick="this.closest('.modal-bg').remove()" style="border:none;background:transparent;font-size:18px;color:var(--muted);cursor:pointer;">✕</button>
    </div>

    <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; font-size:13px; margin-bottom:14px;">
      <div style="background:var(--panel2); padding:10px 12px; border-radius:8px; border:1px solid var(--border);">
        <div style="font-size:11px; color:var(--muted); font-weight:600;">ผู้ส่งคำขอ (Requester)</div>
        <div style="font-weight:600; margin-top:3px;">${esc(r.requesterName)}</div>
        <div style="font-size:11.5px; color:var(--muted); margin-top:1px;">แผนก ${esc(r.department||'-')} · รหัส ${esc(r.requesterEmpId||'-')}</div>
      </div>
      <div style="background:var(--panel2); padding:10px 12px; border-radius:8px; border:1px solid var(--border);">
        <div style="font-size:11px; color:var(--muted); font-weight:600;">ชิ้นงานและจำนวน</div>
        <div style="font-weight:600; margin-top:3px;">${esc(r.productName)}</div>
        <div style="font-size:11.5px; color:var(--muted); margin-top:1px;">จำนวน: <b>${r.quantity||1}</b> ชิ้น / pcs</div>
      </div>
    </div>

    <div style="background:var(--panel2); padding:12px; border-radius:8px; border:1px solid var(--border); font-size:13px; margin-bottom:14px;">
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">
        <div><span style="color:var(--muted);">Rel Test Condition:</span> <b>${esc(r.testCondition)}</b></div>
        <div><span style="color:var(--muted);">Test Condition / Std:</span> <b>${esc(r.testStandard||'-')}</b></div>
        <div><span style="color:var(--muted);">Chamber:</span> <b>${esc(r.chamberName||'ยังไม่กำหนด')}</b></div>
        <div><span style="color:var(--muted);">ช่วงทดสอบ:</span> <span class="mono" style="font-size:12px;">${r.startDateTime ? fmtDateTime(r.startDateTime) + ' → ' + fmtDateTime(r.endDateTime) : '—'}</span></div>
      </div>
    </div>

    ${r.remark ? `
      <div style="margin-bottom:14px;">
        <label style="font-size:12px; font-weight:600; color:var(--muted); display:block; margin-bottom:4px;">วัตถุประสงค์ / หมายเหตุเพิ่มเติม (Remark):</label>
        <div style="background:var(--panel); border:1px solid var(--border); border-radius:8px; padding:10px 12px; font-size:13px; line-height:1.5; white-space:pre-wrap;">${esc(r.remark)}</div>
      </div>
    ` : ''}

    ${renderAttachmentsPreviewHtml(r.attachments)}

    <div class="modal-actions" style="margin-top:20px;">
      ${isAdmin ? `<button class="btn btn-primary" onclick="document.querySelector('.modal-bg').remove(); openPlanModal('${r.id}');">แพลนงาน / แก้ไข</button>` : ''}
      <button class="btn" onclick="this.closest('.modal-bg').remove()">ปิด</button>
    </div>
  </div>`;
  document.body.appendChild(modal);
}

async function savePlan(requestId){
  const chamberId = document.getElementById('plan-chamber').value;
  const startV = document.getElementById('plan-start').value;
  const endV = document.getElementById('plan-end').value;
  const status = document.getElementById('plan-status').value;
  if(!db){ toast('ฐานข้อมูลไม่พร้อมใช้งาน', true); return; }
  const r = REQUESTS.find(x=>x.id===requestId);
  const chamber = CHAMBERS.find(c=>c.id===chamberId);
  const wasUnscheduled = !r.scheduledAt;
  try{
    await db.collection('requests').doc(requestId).update({
      chamberId: chamberId||null,
      chamberName: chamber ? chamber.name : null,
      startDateTime: startV ? new Date(startV).toISOString() : null,
      endDateTime: endV ? new Date(endV).toISOString() : null,
      status,
      scheduledAt: wasUnscheduled && chamberId ? new Date().toISOString() : (r.scheduledAt||null),
    });
    if(chamber){
      await db.collection('chambers').doc(chamber.id).update({
        status: status==='Testing' ? 'running' : (status==='Completed'||status==='Cancelled' ? 'idle' : chamber.status),
        requestId: (status==='Completed'||status==='Cancelled') ? null : requestId,
        requestNo: (status==='Completed'||status==='Cancelled') ? null : r.requestNo,
      });
    }
    toast('บันทึกแพลนงานเรียบร้อย');
    document.querySelectorAll('.modal-bg').forEach(m=>m.remove());
  }catch(e){ toast('บันทึกไม่สำเร็จ: '+(e.message||e), true); }
}
async function deleteRequest(requestId){
  if(!db) return;
  if(!confirm('ยืนยันลบ Request นี้?')) return;
  try{ await db.collection('requests').doc(requestId).delete(); toast('ลบแล้ว'); }
  catch(e){ toast('ลบไม่สำเร็จ', true); }
}

/* ============================================================
   PAGE: Report (admin)
   ============================================================ */
let reportSelectedReqId = null;
let reportFilterStatus = 'all';
let reportSearchQuery = '';

function pageReport(){
  if(!reportSelectedReqId && REQUESTS.length > 0){
    reportSelectedReqId = REQUESTS[0].id;
  }
  const filtered = getFilteredReportRequests();
  const selectedReq = REQUESTS.find(x => x.id === reportSelectedReqId) || (filtered.length ? filtered[0] : null);
  if(selectedReq && !reportSelectedReqId) reportSelectedReqId = selectedReq.id;

  return `
  <div class="page-head">
    <div>
      <h2>ออก Report (Word)</h2>
      <div class="sub">เลือก Request จากรายการ หรือค้นหา แล้วกรอกผลการทดสอบเพื่อสร้างไฟล์ Word (.docx) แบบเต็มหน้าจอ</div>
    </div>
  </div>

  <div class="report-layout-grid">
    <!-- ฝั่งซ้าย: แผงเลือก Request & ค้นหา -->
    <div class="card report-left-panel">
      <div class="report-panel-header">
        <div class="report-panel-title">
          <span>📑</span>
          <span>รายการ Request</span>
        </div>
        <span class="badge badge-primary" id="report-req-count" style="font-size:11px;padding:2px 8px;">${filtered.length} รายการ</span>
      </div>

      <div class="report-search-bar">
        <input id="report-reqno" class="form-input" placeholder="ค้นหา Request No. หรือชื่อ..." value="${esc(reportSearchQuery)}" oninput="filterReportList(this.value)">
        <button class="btn btn-primary" onclick="loadReportRequest()" title="ค้นหา">🔍</button>
      </div>

      <div class="report-filter-chips">
        <button class="report-chip ${reportFilterStatus==='all'?'active':''}" onclick="setReportFilter('all', this)">ทั้งหมด</button>
        <button class="report-chip ${reportFilterStatus==='scheduled'?'active':''}" onclick="setReportFilter('scheduled', this)">Scheduled</button>
        <button class="report-chip ${reportFilterStatus==='done'?'active':''}" onclick="setReportFilter('done', this)">Completed</button>
      </div>

      <div class="report-req-list" id="report-req-list">
        ${renderReportReqItemsHtml(filtered)}
      </div>
    </div>

    <!-- ฝั่งขวา: รายละเอียด Request + ฟอร์ม Report + ปุ่มสร้างไฟล์ Word -->
    <div class="card report-right-panel" id="report-body">
      ${renderReportRightPanelHtml(selectedReq)}
    </div>
  </div>`;
}

function setReportFilter(status, btn){
  reportFilterStatus = status;
  if(btn && btn.parentElement){
    btn.parentElement.querySelectorAll('.report-chip').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  }
  updateReportReqList();
}

function filterReportList(val){
  reportSearchQuery = (val || '').trim().toLowerCase();
  updateReportReqList();
}

function getFilteredReportRequests(){
  return REQUESTS.filter(r => {
    if(reportFilterStatus === 'scheduled' && r.status !== 'scheduled' && r.status !== 'running') return false;
    if(reportFilterStatus === 'done' && r.status !== 'completed' && r.status !== 'done') return false;
    if(reportSearchQuery){
      const q = reportSearchQuery;
      const no = (r.requestNo || '').toLowerCase();
      const prod = (r.productName || '').toLowerCase();
      const reqBy = (r.requesterName || '').toLowerCase();
      const cond = (r.testCondition || '').toLowerCase();
      if(!no.includes(q) && !prod.includes(q) && !reqBy.includes(q) && !cond.includes(q)) return false;
    }
    return true;
  });
}

function renderReportReqItemsHtml(list){
  if(!list.length) return `<div class="empty" style="padding:40px 10px;font-size:13px;">ไม่พบ Request ที่ตรงกับเงื่อนไข</div>`;
  return list.map(r => {
    const isActive = r.id === reportSelectedReqId;
    return `
    <div class="report-req-item ${isActive ? 'active' : ''}" onclick="selectReportRequest('${r.id}')">
      <div class="report-req-item-head">
        <span class="report-req-item-no">${esc(r.requestNo)}</span>
        ${statusBadge(r.status)}
      </div>
      <div class="report-req-item-prod" title="${esc(r.productName)}">${esc(r.productName)}</div>
      <div class="report-req-item-meta">
        <span>👤 ${esc(r.requesterName)}</span>
        <span>•</span>
        <span>${esc(r.testCondition)}</span>
        ${r.chamberName ? `<span>• 🏢 ${esc(r.chamberName)}</span>` : ''}
      </div>
    </div>`;
  }).join('');
}

function updateReportReqList(){
  const listEl = document.getElementById('report-req-list');
  const countEl = document.getElementById('report-req-count');
  const filtered = getFilteredReportRequests();
  if(countEl) countEl.textContent = `${filtered.length} รายการ`;
  if(listEl) listEl.innerHTML = renderReportReqItemsHtml(filtered);
}

function selectReportRequest(reqId){
  reportSelectedReqId = reqId;
  updateReportReqList();
  const r = REQUESTS.find(x => x.id === reqId);
  const body = document.getElementById('report-body');
  if(body) body.innerHTML = renderReportRightPanelHtml(r);
  const inp = document.getElementById('report-reqno');
  if(inp && r) inp.value = r.requestNo;
}

function loadReportRequest(){
  const q = (document.getElementById('report-reqno').value || '').trim().toUpperCase();
  const r = REQUESTS.find(x => x.requestNo && x.requestNo.toUpperCase() === q);
  if(!r){
    toast('ไม่พบ Request หมายเลขนี้', true);
    return;
  }
  selectReportRequest(r.id);
}

function renderReportRightPanelHtml(r){
  if(!r){
    return `
    <div class="report-placeholder">
      <div class="report-placeholder-icon">📑</div>
      <h4>ยังไม่ได้เลือก Request</h4>
      <p>เลือก Request จากรายการทางด้านซ้าย หรือพิมพ์ค้นหาหมายเลข Request เพื่อจัดทำเอกสารและรายงานผลการทดสอบ</p>
    </div>`;
  }
  const rep = r.report || {};
  const c = r.chamberId ? CHAMBERS.find(x => x.id === r.chamberId) : null;
  const chamberText = r.chamberName ? `${r.chamberName} ${c && c.setPoint ? '('+c.setPoint+'°C)' : ''}` : '—';

  return `
  <div class="report-overview-card">
    <div class="report-overview-header">
      <div>
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:4px;flex-wrap:wrap;">
          <span class="report-overview-title mono" style="color:var(--accent);">${esc(r.requestNo)}</span>
          ${statusBadge(r.status)}
          ${requestLine(r) ? lineTag(requestLine(r)) : ''}
        </div>
        <div style="font-size:12px;color:var(--muted);">สร้างคำขอเมื่อ: ${fmtDateTime(r.createdAt)} · แพลนงานเมื่อ: ${fmtDateTime(r.scheduledAt)}</div>
      </div>
    </div>

    <div class="report-overview-grid">
      <div class="report-info-cell">
        <span class="report-info-label">ผลิตภัณฑ์ / ชิ้นงาน</span>
        <span class="report-info-val">${esc(r.productName)}</span>
      </div>
      <div class="report-info-cell">
        <span class="report-info-label">Test Condition</span>
        <span class="report-info-val">${esc(r.testCondition)} ${r.testStandard ? '('+esc(r.testStandard)+')' : ''}</span>
      </div>
      <div class="report-info-cell">
        <span class="report-info-label">จำนวนตัวอย่าง</span>
        <span class="report-info-val">${esc(r.quantity)} ชิ้น / pcs</span>
      </div>
      <div class="report-info-cell">
        <span class="report-info-label">ผู้ส่งคำขอทดสอบ</span>
        <span class="report-info-val">${esc(r.requesterName)} (${esc(r.department)})</span>
      </div>
      <div class="report-info-cell">
        <span class="report-info-label">เครื่องทดสอบ (Chamber)</span>
        <span class="report-info-val">${esc(chamberText)}</span>
      </div>
      <div class="report-info-cell">
        <span class="report-info-label">ช่วงเวลาทดสอบ</span>
        <span class="report-info-val mono" style="font-size:12px;">${fmtDateTime(r.startDateTime)} — ${fmtDateTime(r.endDateTime)}</span>
      </div>
      ${r.remark ? `
      <div class="report-info-cell" style="grid-column:1/-1;">
        <span class="report-info-label">หมายเหตุ / วัตถุประสงค์ (Remark)</span>
        <span class="report-info-val" style="font-weight:400;color:var(--muted);">${esc(r.remark)}</span>
      </div>` : ''}
    </div>

    ${r.attachments && r.attachments.length ? `
    <div style="margin-top:16px;padding-top:14px;border-top:1px solid var(--border);">
      <div style="font-size:12px;font-weight:600;color:var(--muted);margin-bottom:8px;">📎 ไฟล์และรูปภาพแนบ (${r.attachments.length} รายการ)</div>
      <div class="req-attachments-list">
        ${r.attachments.map(att => `
          <a class="req-att-pill" href="${Api.fileUrl(att.url)}" target="_blank" rel="noopener">
            ${att.type && att.type.startsWith('image/') ? `<img src="${Api.fileUrl(att.url)}" class="req-att-thumb-mini">` : `<span class="req-att-badge-mini" style="background:var(--accent);">FILE</span>`}
            <span>${esc(att.name)}</span>
          </a>
        `).join('')}
      </div>
    </div>` : ''}
  </div>

  <div class="form-section" style="margin-bottom:0;padding:20px;border-radius:12px;">
    <div class="form-section-title" style="margin-bottom:14px;">
      <span class="sec-num">📝</span>
      <span>ข้อมูลสำหรับจัดทำรายงาน (Report Parameters)</span>
    </div>
    <div class="form-grid">
      <div>
        <label class="form-label">ผู้ทดสอบ (Tested by) <span class="req-star">*</span></label>
        <input id="rep-testedby" class="form-input" value="${esc(rep.testedBy || CURRENT_USER.name)}">
        <span class="field-hint">ชื่อผู้รับผิดชอบการทดสอบในห้องแล็บ</span>
      </div>
      <div>
        <label class="form-label">อุปกรณ์ที่ใช้ (Equipment) <span class="req-star">*</span></label>
        <input id="rep-equipment" class="form-input" value="${esc(rep.equipment || r.chamberName || '')}">
        <span class="field-hint">ระบุชื่อหรือรหัสเครื่องทดสอบที่ใช้จริง</span>
      </div>
    </div>
  </div>

  <div class="report-actions-footer">
    <div style="font-size:12px;color:var(--muted);display:flex;align-items:center;gap:6px;">
      <span>💡</span>
      <span>ระบบจะดึงข้อมูลการทดสอบและสร้างไฟล์ Microsoft Word (.docx) ตาม Template มาตรฐาน</span>
    </div>
    <button class="report-gen-btn" onclick="generateReport('${r.id}')">
      <span>📄</span>
      <span>Generate Word Report</span>
    </button>
  </div>`;
}
function collectReportForm(){
  return {
    testedBy: document.getElementById('rep-testedby').value.trim(),
    equipment: document.getElementById('rep-equipment').value.trim(),
  };
}
async function saveReportData(requestId){
  if(!db) return;
  const existing = (REQUESTS.find(x=>x.id===requestId)||{}).report || {};
  const rep = { ...existing, ...collectReportForm() };
  try{ await db.collection('requests').doc(requestId).update({ report: rep }); }
  catch(e){ toast('บันทึกไม่สำเร็จ', true); }
}
async function generateReport(requestId){
  const r = REQUESTS.find(x=>x.id===requestId);
  if(!r){ toast('ไม่พบ Request', true); return; }
  const rep = collectReportForm();
  await saveReportData(requestId);
  if(typeof docx === 'undefined'){ toast('ไม่สามารถโหลดไลบรารีสร้างไฟล์ Word ได้', true); return; }

  const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, HeadingLevel, WidthType, AlignmentType, BorderStyle } = docx;

  function labelRow(label, value){
    return new TableRow({ children: [
      new TableCell({ width:{size:30,type:WidthType.PERCENTAGE}, children:[new Paragraph({children:[new TextRun({text:label, bold:true})]})] }),
      new TableCell({ width:{size:70,type:WidthType.PERCENTAGE}, children:[new Paragraph(String(value||'-'))] }),
    ]});
  }

  const doc = new Document({
    sections: [{
      children: [
        new Paragraph({ text: 'Reliability Test Report', heading: HeadingLevel.TITLE, alignment: AlignmentType.CENTER }),
        new Paragraph({ text: r.requestNo, alignment: AlignmentType.CENTER, spacing:{after:300} }),
        new Table({ width:{size:100,type:WidthType.PERCENTAGE}, rows:[
          labelRow('Product / Item', r.productName),
          labelRow('Test Condition', r.testCondition + (r.testStandard?` (${r.testStandard})`:'')),
          labelRow('Quantity', r.quantity + ' pcs'),
          labelRow('Requested by', `${r.requesterName} (${r.department})`),
          labelRow('Chamber / Equipment', rep.equipment || r.chamberName || '-'),
          labelRow('Test Period', `${fmtDateTime(r.startDateTime)}  —  ${fmtDateTime(r.endDateTime)}`),
          labelRow('Tested by', rep.testedBy),
        ]}),
        new Paragraph({ text:'', spacing:{before:400} }),
        new Paragraph(`Report generated: ${fmtDateTime(new Date().toISOString())}   |   Generated by: ${CURRENT_USER.name}`),
      ],
    }],
  });

  try{
    const blob = await Packer.toBlob(doc);
    if(downloadsCap){
      await downloadsCap.save({ filename: `Report_${r.requestNo}.docx`, data: blob });
      toast('สร้างไฟล์ Report เรียบร้อย');
    } else {
      toast('ระบบบันทึกไฟล์ไม่พร้อมใช้งานในหน้านี้', true);
    }
  }catch(e){
    if(e && e.code === 'declined') return;
    toast('สร้างไฟล์ไม่สำเร็จ: '+(e && e.message || e), true);
  }
}

/* ============================================================
   PAGE: KPI Summary
   ============================================================ */
let kpiTab = 'jobs'; // 'jobs' | 'utilization' | 'repairs'
let kpiPeriod = 'all';
let kpiRepairYear = new Date().getFullYear();
let ALL_REPAIRS = [];
let repairsLoaded = false;
let repairsLoading = false;

function switchKpiTab(tab){
  kpiTab = tab;
  if(tab==='repairs' && !repairsLoaded && !repairsLoading) loadAllRepairs();
  render();
}

async function loadAllRepairs(){
  if(!db) return;
  repairsLoading = true;
  if(currentPage==='kpi') render();
  try{
    const all = [];
    for(const c of CHAMBERS){
      const snap = await db.collection('chambers').doc(c.id).collection('repairs').get();
      snap.docs.forEach(d=> all.push({ id:d.id, chamberId:c.id, chamberName:c.name, ...d.data() }));
    }
    ALL_REPAIRS = all;
    repairsLoaded = true;
  }catch(e){ toast('โหลดข้อมูลการซ่อมไม่สำเร็จ', true); }
  repairsLoading = false;
  if(currentPage==='kpi') render();
}

function pageKpi(){
  return `
  <div class="page-head"><div><h2>สรุป KPI</h2><div class="sub">ติดตามประสิทธิภาพของแผนก — งานทดสอบ, การใช้งานเครื่อง และประวัติการซ่อมประจำปี — แยกตามฝั่ง LPN 1 / LPN 2 และรวมทั้งหมด</div></div></div>
  ${lineSwitchHtml(kpiLine, 'kpiLine', true)}
  <div class="detail-tabs">
    <button class="detail-tab ${kpiTab==='jobs'?'active':''}" onclick="switchKpiTab('jobs')">สรุปงาน</button>
    <button class="detail-tab ${kpiTab==='utilization'?'active':''}" onclick="switchKpiTab('utilization')">สรุปการใช้งานเครื่อง</button>
    <button class="detail-tab ${kpiTab==='repairs'?'active':''}" onclick="switchKpiTab('repairs')">สรุปการซ่อมเครื่อง</button>
  </div>
  ${kpiTab==='jobs' ? kpiJobsPane() : kpiTab==='utilization' ? kpiUtilizationPane() : kpiRepairsPane()}
  `;
}

/* side-by-side comparison LPN 1 vs LPN 2 vs total (shown when "ทั้งหมด" selected) */
function kpiLineCompare(){
  const keys = [...LINES, 'all'];
  const avg = arr => arr.length ? arr.reduce((a,b)=>a+b,0)/arr.length : null;
  const yearStart = new Date(new Date().getFullYear(),0,1);
  const stats = keys.map(l=>{
    const rq = filterByLine(REQUESTS, l);
    const ch = chambersOfLine(l);
    const chIds = new Set(ch.map(c=>c.id));
    const durs = rq.filter(r=>r.startDateTime&&r.endDateTime).map(r=>new Date(r.endDateTime)-new Date(r.startDateTime));
    const busyYear = rq.filter(r=>r.startDateTime&&r.endDateTime&&new Date(r.startDateTime)>=yearStart)
      .reduce((s,r)=>s+(new Date(r.endDateTime)-new Date(r.startDateTime)),0)/3600000;
    const reps = ALL_REPAIRS.filter(x=>chIds.has(x.chamberId) && x.startDate && new Date(x.startDate).getFullYear()===kpiRepairYear);
    return {
      total: rq.length,
      completed: rq.filter(r=>r.status==='Completed').length,
      active: rq.filter(r=>r.status==='Testing').length,
      avgDur: avg(durs),
      chambers: ch.length,
      running: ch.filter(c=>c.status==='running').length,
      busyYear,
      repCount: repairsLoaded ? reps.length : null,
      repCost: repairsLoaded ? reps.reduce((s,x)=>s+(x.cost||0),0) : null,
    };
  });
  const row = (label, fn) => `<tr><td>${label}</td>${stats.map((s,i)=>`<td class="mono" ${i===2?'style="font-weight:700;"':''}>${fn(s)}</td>`).join('')}</tr>`;
  return `
  <div class="card" style="margin-bottom:18px;">
    <div style="font-weight:700;margin-bottom:12px;">เปรียบเทียบ LPN 1 / LPN 2 / รวมทั้งหมด</div>
    <div class="table-wrap"><table class="line-compare">
      <thead><tr><th>หัวข้อ</th><th>${lineTag('LPN1')}</th><th>${lineTag('LPN2')}</th><th>รวมทั้งหมด</th></tr></thead>
      <tbody>
        ${row('Request ทั้งหมด', s=>s.total)}
        ${row('ทดสอบเสร็จสิ้น (Completed)', s=>s.completed)}
        ${row('กำลังทดสอบ (Testing)', s=>s.active)}
        ${row('ระยะเวลาทดสอบเฉลี่ย', s=>s.avgDur==null?'—':fmtDur(s.avgDur))}
        ${row('จำนวนเครื่อง / กำลังใช้งาน', s=>`${s.chambers} / ${s.running}`)}
        ${row('ชั่วโมงใช้งานเครื่องปีนี้', s=>s.busyYear.toFixed(0)+' ชม.')}
        ${row(`จำนวนครั้งที่ซ่อม (ปี ${kpiRepairYear+543})`, s=>s.repCount==null?'—':s.repCount)}
        ${row(`ค่าซ่อมรวม (ปี ${kpiRepairYear+543})`, s=>s.repCost==null?'—':s.repCost.toLocaleString('th-TH')+' บาท')}
      </tbody>
    </table></div>
    ${!repairsLoaded ? `<div style="font-size:11.5px;color:var(--muted);margin-top:8px;">${repairsLoading?'กำลังโหลดข้อมูลการซ่อม...':'ข้อมูลการซ่อมยังไม่ถูกโหลด'}</div>` : ''}
  </div>`;
}

function kpiJobsPane(){
  if(!repairsLoaded && !repairsLoading) setTimeout(loadAllRepairs, 0);
  const RQ = filterByLine(REQUESTS, kpiLine);
  const withLead = RQ.filter(r=>r.scheduledAt);
  const withDur = RQ.filter(r=>r.startDateTime && r.endDateTime);
  const leadTimes = withLead.map(r=> new Date(r.scheduledAt) - new Date(r.createdAt));
  const durations = withDur.map(r=> new Date(r.endDateTime) - new Date(r.startDateTime));
  const avg = arr => arr.length ? arr.reduce((a,b)=>a+b,0)/arr.length : null;
  const avgLead = avg(leadTimes);
  const avgDur = avg(durations);
  const completed = RQ.filter(r=>r.status==='Completed').length;
  const total = RQ.length;
  const maxDur = Math.max(1, ...durations);

  const byCondition = {};
  withDur.forEach(r=>{
    byCondition[r.testCondition] = byCondition[r.testCondition] || [];
    byCondition[r.testCondition].push(new Date(r.endDateTime)-new Date(r.startDateTime));
  });

  return `
  ${kpiLine==='all' ? kpiLineCompare() : ''}
  <div style="font-weight:700;margin-bottom:10px;">สรุปงาน — ${LINE_LABEL[kpiLine]}</div>
  <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); margin-bottom:18px;">
    <div class="card kpi-stat"><div class="num">${total}</div><div class="lbl">Request ทั้งหมด</div></div>
    <div class="card kpi-stat"><div class="num">${completed}</div><div class="lbl">ทดสอบเสร็จสิ้น (Completed)</div></div>
    <div class="card kpi-stat"><div class="num">${avgLead==null?'—':fmtDur(avgLead)}</div><div class="lbl">เวลารับงานเฉลี่ย (Request → Scheduled)</div></div>
    <div class="card kpi-stat"><div class="num">${avgDur==null?'—':fmtDur(avgDur)}</div><div class="lbl">ระยะเวลาทดสอบเฉลี่ย</div></div>
  </div>

  <div class="card" style="margin-bottom:18px;">
    <div style="font-weight:700;margin-bottom:12px;">ระยะเวลาทดสอบเฉลี่ยตาม Test Condition</div>
    ${Object.keys(byCondition).length===0 ? '<div class="empty">ยังไม่มีข้อมูลเพียงพอ</div>' : Object.entries(byCondition).map(([cond,arr])=>{
      const a = avg(arr);
      const pct = Math.min(100, (a/maxDur)*100);
      return `<div class="bar-row"><div>${esc(cond)}</div><div class="bar-track"><div class="bar-fill" style="width:${pct}%;"></div></div><div class="mono">${fmtDur(a)}</div></div>`;
    }).join('')}
  </div>

  <div class="card">
    <div style="font-weight:700;margin-bottom:12px;">รายละเอียดต่อ Request</div>
    <div class="table-wrap"><table>
      <thead><tr><th>Request No.</th><th>สถานะ</th><th>เวลารับงาน</th><th>ระยะเวลาทดสอบ</th></tr></thead>
      <tbody>
      ${RQ.map(r=>`<tr>
        <td class="mono">${esc(r.requestNo)}</td>
        <td>${statusBadge(r.status)}</td>
        <td class="mono">${r.scheduledAt ? fmtDur(new Date(r.scheduledAt)-new Date(r.createdAt)) : '—'}</td>
        <td class="mono">${(r.startDateTime&&r.endDateTime) ? fmtDur(new Date(r.endDateTime)-new Date(r.startDateTime)) : '—'}</td>
      </tr>`).join('')}
      </tbody>
    </table></div>
  </div>`;
}

function kpiUtilizationPane(){
  const withDur = filterByLine(REQUESTS, kpiLine).filter(r=>r.startDateTime && r.endDateTime);
  const now = new Date();
  let periodStart;
  if(kpiPeriod==='30') periodStart = new Date(now.getTime()-30*86400000);
  else if(kpiPeriod==='90') periodStart = new Date(now.getTime()-90*86400000);
  else if(kpiPeriod==='year') periodStart = new Date(now.getFullYear(),0,1);
  else {
    const starts = withDur.map(r=>new Date(r.startDateTime).getTime());
    periodStart = starts.length ? new Date(Math.min(...starts)) : new Date(now.getTime()-30*86400000);
  }
  const periodEnd = now;
  const availableHours = Math.max(1, (periodEnd - periodStart) / 3600000);

  const chamberStats = chambersOfLine(kpiLine).map(c=>{
    const jobs = withDur.filter(r=> r.chamberId===c.id && new Date(r.startDateTime) >= periodStart && new Date(r.startDateTime) <= periodEnd);
    const busyMs = jobs.reduce((sum,r)=> sum + (new Date(r.endDateTime)-new Date(r.startDateTime)), 0);
    const busyHours = busyMs/3600000;
    const pct = Math.min(100, (busyHours/availableHours)*100);
    return { chamber:c, jobCount: jobs.length, busyHours, pct };
  }).sort((a,b)=> b.pct - a.pct);

  const totalBusyHours = chamberStats.reduce((s,x)=>s+x.busyHours,0);
  const avgUtilPct = chamberStats.length ? chamberStats.reduce((s,x)=>s+x.pct,0)/chamberStats.length : 0;
  const busiest = chamberStats[0];
  const periodLabelMap = {'30':'30 วันล่าสุด','90':'90 วันล่าสุด','year':'ปีนี้','all':'ทั้งหมด (ตั้งแต่งานแรก)'};

  return `
  <div class="card">
    <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px; margin-bottom:14px;">
      <div style="font-weight:700;">การใช้งานเครื่องทดสอบ (Chamber Utilization) — ${LINE_LABEL[kpiLine]}</div>
      <select onchange="kpiPeriod=this.value; render();" style="width:auto;">
        <option value="30" ${kpiPeriod==='30'?'selected':''}>30 วันล่าสุด</option>
        <option value="90" ${kpiPeriod==='90'?'selected':''}>90 วันล่าสุด</option>
        <option value="year" ${kpiPeriod==='year'?'selected':''}>ปีนี้</option>
        <option value="all" ${kpiPeriod==='all'?'selected':''}>ทั้งหมด</option>
      </select>
    </div>

    <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(160px,1fr)); margin-bottom:16px;">
      <div class="kpi-stat"><div class="num" style="font-size:22px;">${totalBusyHours.toFixed(0)} ชม.</div><div class="lbl">ชั่วโมงใช้งานรวม (${esc(periodLabelMap[kpiPeriod])})</div></div>
      <div class="kpi-stat"><div class="num" style="font-size:22px;">${avgUtilPct.toFixed(0)}%</div><div class="lbl">Utilization เฉลี่ยทุกเครื่อง</div></div>
      <div class="kpi-stat"><div class="num" style="font-size:16px;">${busiest && busiest.pct>0 ? esc(busiest.chamber.name) : '—'}</div><div class="lbl">เครื่องที่ถูกใช้งานมากที่สุด</div></div>
    </div>

    ${chamberStats.length===0 ? '<div class="empty">ยังไม่มีข้อมูลเครื่องทดสอบ</div>' : chamberStats.map(cs=>`
      <div class="bar-row" style="grid-template-columns:150px 1fr 130px;">
        <div>${esc(cs.chamber.name)}<div style="font-size:10.5px;color:var(--muted);">${kpiLine==='all'?LINE_LABEL[chamberLine(cs.chamber)]+' · ':''}${cs.jobCount} งาน</div></div>
        <div class="bar-track"><div class="bar-fill" style="width:${cs.pct}%;"></div></div>
        <div class="mono">${cs.pct.toFixed(0)}% · ${cs.busyHours.toFixed(0)}ชม.</div>
      </div>`).join('')}
  </div>`;
}

function kpiYearOptions(){
  const now = new Date().getFullYear();
  let opts = '';
  for(let y=now; y>=now-9; y--) opts += `<option value="${y}" ${y===kpiRepairYear?'selected':''}>${y+543}</option>`;
  return opts;
}

function kpiRepairsPane(){
  if(repairsLoading){
    return `<div class="card"><div class="empty">กำลังโหลดข้อมูลการซ่อม...</div></div>`;
  }
  const lineIds = new Set(chambersOfLine(kpiLine).map(c=>c.id));
  const yearRepairs = ALL_REPAIRS.filter(r=> lineIds.has(r.chamberId) && r.startDate && new Date(r.startDate).getFullYear()===kpiRepairYear);
  const totalCost = yearRepairs.reduce((s,r)=> s + (r.cost||0), 0);
  const totalCount = yearRepairs.length;

  const byChamber = {};
  yearRepairs.forEach(r=>{
    byChamber[r.chamberName] = byChamber[r.chamberName] || { count:0, cost:0 };
    byChamber[r.chamberName].count++;
    byChamber[r.chamberName].cost += (r.cost||0);
  });
  const maxCost = Math.max(1, ...Object.values(byChamber).map(x=>x.cost));

  const sorted = [...yearRepairs].sort((a,b)=> new Date(b.startDate)-new Date(a.startDate));

  return `
  <div class="card" style="margin-bottom:18px;">
    <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px; margin-bottom:14px;">
      <div style="font-weight:700;">สรุปการซ่อมเครื่องประจำปี — ${LINE_LABEL[kpiLine]}</div>
      <select onchange="kpiRepairYear=Number(this.value); render();" style="width:auto;">
        ${kpiYearOptions()}
      </select>
    </div>
    <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(160px,1fr)); margin-bottom:16px;">
      <div class="kpi-stat"><div class="num" style="font-size:22px;">${totalCount}</div><div class="lbl">จำนวนครั้งที่ซ่อม (ปี ${kpiRepairYear+543})</div></div>
      <div class="kpi-stat"><div class="num" style="font-size:22px;">${totalCost.toLocaleString('th-TH')}</div><div class="lbl">ค่าใช้จ่ายรวม (บาท)</div></div>
      <div class="kpi-stat"><div class="num" style="font-size:16px;">${Object.keys(byChamber).length}</div><div class="lbl">จำนวนเครื่องที่มีการซ่อม</div></div>
    </div>
    ${Object.keys(byChamber).length===0 ? '<div class="empty">ไม่มีประวัติการซ่อมในปีนี้</div>' : Object.entries(byChamber).sort((a,b)=>b[1].cost-a[1].cost).map(([name,v])=>{
      const pct = Math.min(100, (v.cost/maxCost)*100);
      return `<div class="bar-row" style="grid-template-columns:150px 1fr 130px;">
        <div>${esc(name)}<div style="font-size:10.5px;color:var(--muted);">${v.count} ครั้ง</div></div>
        <div class="bar-track"><div class="bar-fill" style="width:${pct}%;"></div></div>
        <div class="mono">${v.cost.toLocaleString('th-TH')} บาท</div>
      </div>`;
    }).join('')}
  </div>

  <div class="card">
    <div style="font-weight:700;margin-bottom:12px;">รายการซ่อมทั้งหมดในปีนี้</div>
    ${sorted.length===0 ? '<div class="empty">ไม่มีประวัติการซ่อมในปีนี้</div>' : `
    <div class="table-wrap"><table>
      <thead><tr><th>เครื่อง</th><th>ซ่อมวันที่</th><th>ถึงวันที่</th><th>ค่าใช้จ่าย</th><th>รายละเอียด</th></tr></thead>
      <tbody>
      ${sorted.map(r=>`<tr>
        <td>${esc(r.chamberName)}</td>
        <td class="mono">${fmtDate(r.startDate)}</td>
        <td class="mono">${fmtDate(r.endDate)}</td>
        <td class="mono">${r.cost!=null ? r.cost.toLocaleString('th-TH')+' บาท' : '—'}</td>
        <td>${esc(r.details||'-')}</td>
      </tr>`).join('')}
      </tbody>
    </table></div>`}
  </div>`;
}

/* ============================================================
   PAGE: Settings (admin)
   ============================================================ */
let settingsTab = 'chambers'; // 'chambers' | 'employees' | 'account'
function switchSettingsTab(t){ settingsTab = t; render(); }

function pageSettings(){
  const tabs = [
    {id:'chambers', label:`เครื่องทดสอบ <span class="set-count">${CHAMBERS.length}</span>`},
    {id:'employees', label:`พนักงาน <span class="set-count">${EMPLOYEES.length}</span>`},
    {id:'account', label:'บัญชีของฉัน'},
  ];
  return `
  <div class="page-head"><div><h2>ตั้งค่าระบบ</h2><div class="sub">จัดการเครื่องทดสอบ บัญชีพนักงาน และรหัสผ่านของคุณ</div></div></div>
  <div class="detail-tabs">
    ${tabs.map(t=>`<button class="detail-tab ${settingsTab===t.id?'active':''}" onclick="switchSettingsTab('${t.id}')">${t.label}</button>`).join('')}
  </div>
  ${settingsTab==='chambers' ? settingsChambers() : settingsTab==='employees' ? settingsEmployees() : settingsAccount()}`;
}

function settingsChambers(){
  const statusOpts = c => ['idle','running','maintenance'].map(s=>{
    const label = s.charAt(0).toUpperCase() + s.slice(1);
    return `<option value="${s}" ${c.status===s?'selected':''}>${label}</option>`;
  }).join('');
  return `<div class="set-cols">
  ${LINES.map(line=>{
    const list = chambersOfLine(line);
    return `<div class="card set-card">
      <div class="set-card-head">${lineTag(line)}<span class="line-count">${list.length} เครื่อง</span>
        <button class="btn btn-sm btn-primary" style="margin-left:auto;" onclick="addChamber('${line}')">+ เพิ่มเครื่อง</button>
      </div>
      ${list.length===0 ? '<div class="empty" style="padding:16px 0;">ยังไม่มีเครื่องในฝั่งนี้</div>' : list.map(c=>`
        <div class="set-row">
          <span class="set-dot st-${esc(c.status)}" title="${esc(c.status)}"></span>
          <input class="in-sm" value="${esc(c.name)}" id="ch-name-${c.id}" style="flex:1;min-width:0;" title="ชื่อเครื่อง">
          <select class="in-sm" id="ch-status-${c.id}" style="width:118px;" title="สถานะ">${statusOpts(c)}</select>
          <select class="in-sm" id="ch-line-${c.id}" style="width:78px;" title="ย้ายฝั่ง">${LINES.map(l=>`<option value="${l}" ${chamberLine(c)===l?'selected':''}>${LINE_LABEL[l]}</option>`).join('')}</select>
          <button class="icon-btn" title="บันทึก" onclick="saveChamber('${c.id}')">✓</button>
          <button class="icon-btn danger" title="ลบเครื่อง" onclick="deleteChamber('${c.id}')">−</button>
        </div>`).join('')}
    </div>`;
  }).join('')}
  </div>`;
}

function settingsEmployees(){
  return `<div class="card set-card">
    <div class="set-row set-add">
      <input class="in-sm" id="new-emp-id" maxlength="6" inputmode="numeric" placeholder="รหัส 6 หลัก" style="width:110px;">
      <input class="in-sm" id="new-emp-name" placeholder="ชื่อ-นามสกุล" style="flex:1;min-width:120px;">
      <input class="in-sm" id="new-emp-dept" placeholder="แผนก" style="width:120px;">
      <select class="in-sm" id="new-emp-role" style="width:110px;"><option value="requester">Requester</option><option value="admin">Admin</option></select>
      <button class="btn btn-sm btn-primary" onclick="addEmployee()">+ เพิ่มพนักงาน</button>
    </div>
    <div class="set-hint">รหัสผ่านเริ่มต้น = เลข 4 หลักท้ายของรหัสพนักงาน</div>
    ${EMPLOYEES.length===0 ? '<div class="empty" style="padding:16px 0;">ยังไม่มีพนักงาน</div>' : EMPLOYEES.map(e=>`
      <div class="set-row">
        <span class="mono set-id">${esc(e.empId)}</span>
        <input class="in-sm" value="${esc(e.name)}" id="emp-name-${e.id}" style="flex:1;min-width:120px;" title="ชื่อ">
        <input class="in-sm" value="${esc(e.dept)}" id="emp-dept-${e.id}" style="width:120px;" title="แผนก">
        <select class="in-sm" id="emp-role-${e.id}" style="width:110px;" title="สิทธิ์">
          <option value="requester" ${e.role==='requester'?'selected':''}>Requester</option>
          <option value="admin" ${e.role==='admin'?'selected':''}>Admin</option>
        </select>
        <button class="icon-btn" title="บันทึก" onclick="saveEmployee('${e.id}')">✓</button>
        <button class="icon-btn" title="รีเซ็ตรหัสผ่าน" onclick="resetEmployeePassword('${e.id}','${esc(e.empId)}')">↺</button>
        <button class="icon-btn danger" title="ลบพนักงาน" onclick="deleteEmployee('${e.id}')">−</button>
      </div>`).join('')}
  </div>`;
}

function settingsAccount(){
  return `<div class="card set-card" style="max-width:760px;">
    <div style="font-weight:700;margin-bottom:10px;">เปลี่ยนรหัสผ่าน — ${esc(CURRENT_USER.name)} · <span class="mono">${esc(CURRENT_USER.empId)}</span></div>
    <div class="set-row set-add" style="border:0;padding:0;">
      <input class="in-sm" type="password" id="pw-current" placeholder="รหัสผ่านปัจจุบัน" style="flex:1;min-width:140px;">
      <input class="in-sm" type="password" id="pw-new" placeholder="รหัสผ่านใหม่" style="flex:1;min-width:140px;">
      <input class="in-sm" type="password" id="pw-confirm" placeholder="ยืนยันรหัสผ่านใหม่" style="flex:1;min-width:140px;">
      <button class="btn btn-sm btn-primary" onclick="changeMyPassword()">บันทึก</button>
    </div>
    <div class="login-err" id="pw-err"></div>
  </div>`;
}

async function changeMyPassword(){
  const cur = document.getElementById('pw-current').value;
  const next = document.getElementById('pw-new').value;
  const confirm2 = document.getElementById('pw-confirm').value;
  const err = document.getElementById('pw-err');
  err.textContent = '';
  try{
    if(!cur){ err.textContent = 'กรุณากรอกรหัสผ่านปัจจุบัน'; return; }
    if(!next || next.length < 4){ err.textContent = 'รหัสผ่านใหม่ต้องมีอย่างน้อย 4 ตัวอักษร'; return; }
    if(next !== confirm2){ err.textContent = 'รหัสผ่านใหม่และการยืนยันไม่ตรงกัน'; return; }
    await Api.changePassword(cur, next);
    toast('เปลี่ยนรหัสผ่านสำเร็จ');
    document.getElementById('pw-current').value = '';
    document.getElementById('pw-new').value = '';
    document.getElementById('pw-confirm').value = '';
  }catch(e){ err.textContent = 'เปลี่ยนรหัสผ่านไม่สำเร็จ: '+(e.message||e); }
}

async function saveEmployee(docId){
  if(!db) return;
  const name = document.getElementById(`emp-name-${docId}`).value.trim();
  const dept = document.getElementById(`emp-dept-${docId}`).value.trim();
  const role = document.getElementById(`emp-role-${docId}`).value;
  try{ await db.collection('employees').doc(docId).update({ name, dept, role }); toast('บันทึกแล้ว'); }
  catch(e){ toast('บันทึกไม่สำเร็จ', true); }
}
async function resetEmployeePassword(docId, empId){
  if(!db) return;
  if(!confirm(`รีเซ็ตรหัสผ่านของรหัสพนักงาน ${empId} กลับเป็นเลข 4 หลักท้าย?`)) return;
  try{ await db.collection('employees').doc(docId).update({ password: last4(empId) }); toast('รีเซ็ตรหัสผ่านแล้ว'); }
  catch(e){ toast('รีเซ็ตไม่สำเร็จ', true); }
}
async function deleteEmployee(docId){
  if(!db) return;
  if(docId === CURRENT_USER.empId){ toast('ไม่สามารถลบบัญชีของตนเองได้', true); return; }
  if(!confirm('ยืนยันลบพนักงานคนนี้?')) return;
  try{ await db.collection('employees').doc(docId).delete(); toast('ลบแล้ว'); }
  catch(e){ toast('ลบไม่สำเร็จ', true); }
}
async function addEmployee(){
  if(!db) return;
  const empId = document.getElementById('new-emp-id').value.trim();
  const name = document.getElementById('new-emp-name').value.trim();
  const dept = document.getElementById('new-emp-dept').value.trim();
  const role = document.getElementById('new-emp-role').value;
  if(!/^\d{6}$/.test(empId)){ toast('รหัสพนักงานต้องเป็นตัวเลข 6 หลัก', true); return; }
  if(!name){ toast('กรุณากรอกชื่อ', true); return; }
  try{
    const existing = await db.doc('employees/'+empId).get();
    if(existing.exists){ toast('มีรหัสพนักงานนี้อยู่แล้วในระบบ', true); return; }
    await db.doc('employees/'+empId).set({ empId, name, dept: dept||'-', role, password: last4(empId), createdAt: new Date().toISOString() });
    toast(`เพิ่มพนักงาน ${empId} เรียบร้อย (รหัสผ่านเริ่มต้น: ${last4(empId)})`);
    document.getElementById('new-emp-id').value='';
    document.getElementById('new-emp-name').value='';
    document.getElementById('new-emp-dept').value='';
  }catch(e){ toast('เพิ่มไม่สำเร็จ: '+(e.message||e), true); }
}
async function saveChamber(id){
  if(!db) return;
  const name = document.getElementById(`ch-name-${id}`).value.trim();
  const status = document.getElementById(`ch-status-${id}`).value;
  const line = document.getElementById(`ch-line-${id}`).value;
  try{ await db.collection('chambers').doc(id).update({ name, status, line }); toast('บันทึกแล้ว'); }
  catch(e){ toast('บันทึกไม่สำเร็จ', true); }
}
async function addChamber(line){
  if(!db) return;
  line = LINES.includes(line) ? line : 'LPN1';
  try{ await db.collection('chambers').add({ name:'New Chamber', setPoint:25, status:'idle', line, requestId:null, requestNo:null }); toast(`เพิ่มเครื่องทดสอบ ${LINE_LABEL[line]} แล้ว`); }
  catch(e){ toast('เพิ่มไม่สำเร็จ', true); }
}
async function deleteChamber(id){
  if(!db) return;
  const c = CHAMBERS.find(x=>x.id===id);
  if(c && c.status==='running'){ toast('ไม่สามารถลบเครื่องที่กำลังทดสอบอยู่ได้', true); return; }
  if(!confirm(`ยืนยันลบเครื่องทดสอบ "${c?c.name:id}"?`)) return;
  try{ await db.collection('chambers').doc(id).delete(); toast('ลบเครื่องทดสอบแล้ว'); }
  catch(e){ toast('ลบไม่สำเร็จ', true); }
}

/* ---------- start ---------- */
boot();
