'use strict';

/* FieldConnect Group · cliente web Supabase
 * No se incluye ninguna clave secreta. La seguridad vive en Auth + RLS + RPC.
 */
const $ = (id) => document.getElementById(id);
const ROLE_LABELS = { HR: 'Personal administrativo', SUPPORT: 'Ingeniería de apoyo', IDC: 'Ingeniero de campo (IDC)' };
const ROLE_TITLES = { HR: 'Personal administrativo', SUPPORT: 'Ingeniería de apoyo remoto', IDC: 'Ingeniero de campo' };
const STATUSES = ['Disponible', 'Asignado', 'En progreso', 'En espera', 'Completado', 'Cancelado'];
const SERVICE_TYPES = ['Activación de enlace', 'Instalación de APS', 'Migración a fibra', 'Monitoreo', 'Levantamiento técnico', 'Soporte técnico'];
const CHECKLIST_ITEMS = [
  'Confirmar contacto, acceso, fecha y hora',
  'Validar herramientas y materiales',
  'Revisar condiciones del sitio y alcance',
  'Ejecutar pruebas autorizadas',
  'Registrar evidencias y reporte',
  'Confirmar resultado con responsable'
];
const ALLOWED_EVIDENCE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const MAX_EVIDENCE_SIZE = 10 * 1024 * 1024;

let supabaseClient = null;
let currentUser = null;
let selectedRole = 'HR';
let tickets = [];
let profileById = {};
let profileByCode = {};
let selectedTicketId = null;
let realtimeChannel = null;
let toastTimer = null;

function safe(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
function todayLocalISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function formatDate(value) {
  if (!value) return 'Por confirmar';
  const parts = String(value).split('-');
  return parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : value;
}
function formatLogDate(value) {
  if (!value) return '';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' });
}
function money(value) {
  if (value === null || value === undefined || value === '') return 'Por confirmar';
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 2 }).format(Number(value) || 0);
}
function toast(message) {
  const el = $('toast');
  if (!el) return;
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 4200);
}
function loginError(message) {
  const el = $('loginError');
  el.textContent = message;
  el.classList.remove('hidden');
}
function clearLoginError() {
  $('loginError').textContent = '';
  $('loginError').classList.add('hidden');
}
function statusClass(status) {
  return ({ Disponible: 'p-available', Asignado: 'p-assigned', 'En progreso': 'p-progress', 'En espera': 'p-wait', Completado: 'p-done', Cancelado: 'p-cancel' })[status] || 'p-cancel';
}
function statusPill(status) { return `<span class="pill ${statusClass(status)}">${safe(status)}</span>`; }
function newLog(title, desc) {
  return { title, desc, at: new Date().toISOString() };
}
function roleName(role) { return ROLE_LABELS[role] || role || 'Personal'; }
function profileName(profileId) {
  const profile = profileById[profileId];
  return profile ? `${profile.employee_code} · ${profile.name}` : 'Personal por confirmar';
}
function assignedLabel(ticket) {
  const support = ticket.supportEngineerUserId ? `Apoyo: ${profileName(ticket.supportEngineerUserId)}` : 'Pendiente de ingeniería de apoyo';
  const idc = ticket.assignedToUserId ? `IDC: ${profileName(ticket.assignedToUserId)}` : 'IDC pendiente';
  return `${support} · ${idc}`;
}
function mapTicket(row) {
  return {
    dbId: row.id,
    id: row.ticket_code,
    siteId: row.site_id || '',
    project: row.project || '',
    client: row.client || '',
    site: row.site || '',
    city: row.city || '',
    address: row.address || '',
    contact: row.contact || '',
    phone: row.phone || '',
    type: row.service_type,
    date: row.service_date,
    time: String(row.service_time || '').slice(0, 5),
    priority: row.priority || 'Normal',
    status: row.status,
    assignedToUserId: row.assigned_to || null,
    assignedTo: row.assigned_to ? (profileById[row.assigned_to]?.employee_code || row.assigned_to) : null,
    supportEngineerUserId: row.support_engineer_id || null,
    supportEngineerId: row.support_engineer_id ? (profileById[row.support_engineer_id]?.employee_code || row.support_engineer_id) : null,
    scope: row.scope || '',
    tools: row.tools || '',
    notes: row.notes || '',
    fee: row.fee_mxn === null ? null : Number(row.fee_mxn),
    travel: Number(row.travel_mxn) || 0,
    payStatus: row.pay_status || 'Por confirmar',
    checklist: row.checklist || {},
    evidence: Number(row.evidence_count) || 0,
    closeNote: row.close_note || '',
    logs: Array.isArray(row.logs) ? row.logs : [],
    createdBy: row.created_by,
    createdAt: row.created_at,
    completedAt: row.completed_at
  };
}
function ticketByCode(code) { return tickets.find((ticket) => ticket.id === code || ticket.dbId === code); }
function matches(ticket, query) {
  const q = String(query || '').toLowerCase().trim();
  return !q || [ticket.id, ticket.siteId, ticket.client, ticket.site, ticket.city, ticket.address, ticket.contact,
    ticket.type, ticket.assignedTo, ticket.supportEngineerId, ticket.project, ticket.scope, ticket.tools, ticket.notes]
    .some((value) => String(value || '').toLowerCase().includes(q));
}
function applyRoleUI() {
  const role = currentUser.role;
  const isHR = role === 'HR';
  const isSupport = role === 'SUPPORT';
  $('navHR').classList.toggle('hidden', !isHR);
  $('navIDC').classList.toggle('hidden', isHR);
  $('roleBadge').textContent = roleName(role);
  $('userName').textContent = currentUser.name;
  $('userRole').textContent = isHR ? 'Personal administrativo' : `${currentUser.employee_code} · ${ROLE_TITLES[role]}`;
  $('userAvatar').textContent = isHR ? 'PA' : currentUser.employee_code.replace(/[^A-Z0-9]/gi, '').slice(-2);
  $('sideRoleTitle').textContent = isHR ? 'Administración de servicios' : isSupport ? 'Coordinación logística remota' : 'Bandeja del ingeniero de campo';
  $('sideRoleCopy').textContent = isHR
    ? 'Publica tickets y supervisa su ciclo completo.'
    : isSupport
      ? 'Toma tickets publicados y confirma la logística antes de habilitarlos para los IDC.'
      : 'Consulta y toma servicios con apoyo logístico confirmado.';
  const availableNav = $('navIDC').querySelector('[data-page="available"]');
  const mineNav = $('navIDC').querySelector('[data-page="myTickets"]');
  availableNav.textContent = isSupport ? 'Tickets por coordinar' : 'Servicios disponibles';
  mineNav.textContent = isSupport ? 'Mi logística' : 'Mis servicios';
  const availablePage = $('page-available');
  availablePage.querySelector('h1').textContent = isSupport ? 'Tickets por coordinar' : 'Servicios disponibles';
  availablePage.querySelector('.welcome p').textContent = isSupport
    ? 'Toma tickets publicados por personal administrativo y coordina remotamente la logística antes de habilitarlos para los IDC.'
    : 'Servicios publicados por personal administrativo y con coordinación logística confirmada.';
  $('loginScreen').classList.add('hidden');
  $('appShell').classList.remove('hidden');
}
function setSelectedRole(role) {
  selectedRole = role;
  $('loginForm').dataset.role = role;
  $('pickHR').classList.toggle('selected', role === 'HR');
  $('pickSupport').classList.toggle('selected', role === 'SUPPORT');
  $('pickIDC').classList.toggle('selected', role === 'IDC');
  $('idcPickerField').classList.toggle('hidden', role === 'HR');
  $('roleHint').textContent = role === 'SUPPORT'
    ? 'Tu cuenta debe tener el rol Ingeniería de apoyo asignado por el administrador de FieldConnect.'
    : role === 'IDC'
      ? 'Tu cuenta debe tener el rol IDC asignado por el administrador de FieldConnect.'
      : 'Tu cuenta debe tener el rol Personal administrativo asignado por el administrador de FieldConnect.';
  clearLoginError();
}
async function fetchProfile(userId) {
  const { data, error } = await supabaseClient.from('profiles')
    .select('id, employee_code, name, role')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}
async function loadProfiles() {
  const { data, error } = await supabaseClient.from('profiles').select('id, employee_code, name, role').order('employee_code');
  if (error) throw error;
  profileById = {};
  profileByCode = {};
  (data || []).forEach((profile) => {
    profileById[profile.id] = profile;
    profileByCode[profile.employee_code] = profile;
  });
}
async function loadTickets({ silent = false } = {}) {
  if (!currentUser || !supabaseClient) return;
  const { data, error } = await supabaseClient.from('tickets').select('*').order('created_at', { ascending: false });
  if (error) {
    if (!silent) toast(`No se pudieron cargar los tickets: ${error.message}`);
    return;
  }
  tickets = (data || []).map(mapTicket);
  renderAll();
}
async function enterApp(authUser, expectedRole = null) {
  const profile = await fetchProfile(authUser.id);
  if (!profile) {
    await supabaseClient.auth.signOut();
    throw new Error('Tu cuenta todavía no tiene un perfil operativo. Pide al administrador que te registre en public.profiles.');
  }
  if (expectedRole && profile.role !== expectedRole) {
    await supabaseClient.auth.signOut();
    throw new Error(`Tu cuenta tiene el perfil “${roleName(profile.role)}”, no “${roleName(expectedRole)}”. Selecciona el perfil correcto.`);
  }
  if (!['HR', 'SUPPORT', 'IDC'].includes(profile.role)) {
    await supabaseClient.auth.signOut();
    throw new Error('El perfil operativo no tiene un rol válido. Contacta al administrador.');
  }
  await loadProfiles();
  currentUser = profile;
  applyRoleUI();
  await loadTickets();
  subscribeRealtime();
  goPage(profile.role === 'HR' ? 'overview' : 'available');
}
async function handleLogin(event) {
  event.preventDefault();
  if (!supabaseClient) {
    loginError('Primero configura la URL y la clave publicable de Supabase en assets/js/supabase-config.js.');
    return;
  }
  clearLoginError();
  const email = $('loginId').value.trim();
  const password = $('loginPass').value;
  const button = $('loginForm').querySelector('button[type="submit"]');
  button.disabled = true;
  button.textContent = 'Validando acceso…';
  try {
    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) throw error;
    await enterApp(data.user, selectedRole);
  } catch (error) {
    loginError(error?.message || 'No se pudo iniciar sesión. Verifica tus credenciales.');
  } finally {
    button.disabled = false;
    button.textContent = 'Entrar a la plataforma →';
  }
}
async function handleLogout() {
  if (realtimeChannel) {
    await supabaseClient.removeChannel(realtimeChannel);
    realtimeChannel = null;
  }
  await supabaseClient.auth.signOut();
  currentUser = null;
  tickets = [];
  profileById = {};
  profileByCode = {};
  selectedTicketId = null;
  $('detailOverlay').classList.remove('open');
  $('appShell').classList.add('hidden');
  $('loginScreen').classList.remove('hidden');
  $('loginPass').value = '';
  setSelectedRole('HR');
}
function subscribeRealtime() {
  if (!supabaseClient || realtimeChannel) return;
  realtimeChannel = supabaseClient.channel('fieldconnect-live-tickets')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'tickets' }, () => { void loadTickets({ silent: true }); })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'ticket_evidence' }, () => {
      void loadTickets({ silent: true });
      if (selectedTicketId && $('detailOverlay').classList.contains('open')) {
        const current = ticketByCode(selectedTicketId);
        if (current) void loadTicketEvidence(current);
      }
    })
    .subscribe();
}

function pageMeta(key) {
  return ({ overview: ['Resumen', 'Centro de operaciones'], tickets: ['Tickets', 'Todos los tickets'], new: ['Crear ticket', 'Alta de servicio'], available: ['Servicios disponibles', 'Bandeja de servicios'], myTickets: ['Mis servicios', 'Agenda personal'] })[key];
}
function goPage(key) {
  if (!pageMeta(key) || !currentUser) return;
  if (currentUser.role === 'HR' && ['available', 'myTickets'].includes(key)) return;
  if (currentUser.role !== 'HR' && !['available', 'myTickets'].includes(key)) return;
  document.querySelectorAll('.page').forEach((el) => el.classList.remove('active'));
  $('page-' + key).classList.add('active');
  document.querySelectorAll('[data-page]').forEach((button) => button.classList.toggle('active', button.dataset.page === key));
  $('crumb').textContent = pageMeta(key)[0];
  $('topTitle').textContent = pageMeta(key)[1];
  window.scrollTo({ top: 0, behavior: 'smooth' });
  if (key === 'new') $('fDate').value = $('fDate').value || todayLocalISO();
}
function renderTableRow(ticket) {
  return `<tr data-id="${safe(ticket.id)}">
    <td><div class="ticket-id">${safe(ticket.id)}</div><div class="td-sub">SITE ID: ${safe(ticket.siteId || '—')}</div></td>
    <td><div class="td-title">${safe(ticket.client)}</div><div class="td-sub">${safe(ticket.site)} · ${safe(ticket.city)}</div></td>
    <td><div class="td-title">${safe(ticket.type)}</div><div class="td-sub">${safe(ticket.priority || 'Normal')} prioridad</div></td>
    <td>${formatDate(ticket.date)}<div class="td-sub">${safe(ticket.time || 'Hora por confirmar')}</div></td>
    <td>${safe(assignedLabel(ticket))}</td><td>${statusPill(ticket.status)}</td>
    <td><button class="btn btn-secondary btn-sm" data-detail="${safe(ticket.id)}">Abrir</button></td>
  </tr>`;
}
function renderActivity() {
  const items = tickets.flatMap((ticket) => (ticket.logs || []).map((entry) => ({ ...entry, ticket: ticket.id })))
    .sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0)).slice(0, 7);
  $('activityHR').innerHTML = items.length ? items.map((entry) => `<div class="activity-row"><div class="activity-icon">↻</div><div><strong>${safe(entry.title || 'Movimiento')} · ${safe(entry.ticket)}</strong><p>${safe(entry.desc || '')}</p><p class="muted">${safe(formatLogDate(entry.at))}</p></div></div>`).join('') : '<div class="empty">Aún no hay movimientos.</div>';
}
function renderHR() {
  const availableCount = tickets.filter((t) => t.status === 'Disponible' && !t.assignedToUserId).length;
  const progressCount = tickets.filter((t) => t.status === 'En progreso').length;
  const doneCount = tickets.filter((t) => t.status === 'Completado').length;
  $('hrStats').innerHTML = [
    ['Tickets totales', tickets.length, 'Servicios registrados', '▤'],
    ['Disponibles', availableCount, 'Esperan coordinación o asignación', '◉'],
    ['En ejecución', progressCount, 'Trabajo iniciado', '⚙'],
    ['Completados', doneCount, 'Servicios cerrados', '✓']
  ].map((stat) => `<article class="stat"><div class="stat-label">${stat[0]}<span>${stat[3]}</span></div><div class="stat-number">${stat[1]}</div><div class="stat-foot">${stat[2]}</div></article>`).join('');
  const recent = tickets.filter((t) => matches(t, $('hrSearch').value) && ($('hrStatusFilter').value === 'all' || t.status === $('hrStatusFilter').value));
  $('hrRows').innerHTML = recent.slice(0, 9).map(renderTableRow).join('');
  $('hrEmpty').classList.toggle('hidden', recent.length > 0);
  const all = tickets.filter((t) => matches(t, $('allSearch').value)
    && ($('allStatus').value === 'all' || t.status === $('allStatus').value)
    && ($('allType').value === 'all' || t.type === $('allType').value));
  $('allRows').innerHTML = all.map(renderTableRow).join('');
  $('allEmpty').classList.toggle('hidden', all.length > 0);
  renderActivity();
}
function typeIcon(type) {
  return ({ 'Instalación de APS': '⌁', 'Activación de enlace': '⇄', 'Migración a fibra': '◈', Monitoreo: '⌁', 'Levantamiento técnico': '⌖', 'Soporte técnico': '⚙' })[type] || '▤';
}
function serviceCard(ticket, mode) {
  let action = '';
  if (mode === 'supportAvailable') action = `<button class="btn btn-primary" data-support-claim="${safe(ticket.id)}">Tomar logística</button>`;
  else if (mode === 'supportMine') action = `<button class="btn btn-secondary" data-detail="${safe(ticket.id)}">Ver ticket y logística</button>`;
  else if (mode === 'idcAvailable') action = `<button class="btn btn-primary" data-claim="${safe(ticket.id)}">Tomar servicio</button>`;
  else if (mode === 'idcMine') {
    if (ticket.status === 'Asignado') action += `<button class="btn btn-primary" data-status="En progreso" data-ticket="${safe(ticket.id)}">Iniciar servicio</button>`;
    action += `<button class="btn btn-secondary" data-detail="${safe(ticket.id)}">${ticket.status === 'Completado' || ticket.status === 'Cancelado' ? 'Ver reporte' : 'Actualizar / detalle'}</button>`;
  }
  return `<article class="service-card">
    <div class="card-top"><div style="display:flex;gap:11px;min-width:0"><div class="type-icon">${typeIcon(ticket.type)}</div><div><h3>${safe(ticket.type)}</h3><div class="client">${safe(ticket.client)} · ${safe(ticket.id)}</div></div></div>${statusPill(ticket.status)}</div>
    <div><div class="td-title">${safe(ticket.site)}</div><div class="td-sub">${safe(ticket.city)}</div></div>
    <div class="meta-grid"><div><div class="meta-label">Fecha y hora</div><div class="meta-value">${formatDate(ticket.date)} · ${safe(ticket.time || 'Por confirmar')}</div></div><div><div class="meta-label">Prioridad</div><div class="meta-value">${safe(ticket.priority || 'Normal')}</div></div><div><div class="meta-label">Viáticos</div><div class="meta-value">${money(ticket.travel)}</div></div><div><div class="meta-label">Pago de servicio</div><div class="meta-value">${money(ticket.fee)}</div></div></div>
    <div class="card-desc">${safe((ticket.scope || 'Sin alcance registrado').length > 200 ? ticket.scope.slice(0, 200) + '…' : ticket.scope || 'Sin alcance registrado')}</div>
    <div class="tools-chip"><strong>Herramientas requeridas:</strong><br>${safe(ticket.tools || 'Por confirmar con coordinación')}</div>
    <div class="card-actions"><button class="btn btn-secondary" data-detail="${safe(ticket.id)}">Ver ticket completo</button>${action}</div>
  </article>`;
}
function renderAvailable() {
  const isSupport = currentUser.role === 'SUPPORT';
  const open = tickets.filter((t) => t.status === 'Disponible' && !t.assignedToUserId && (isSupport ? !t.supportEngineerUserId : Boolean(t.supportEngineerUserId)));
  const query = $('availableSearch').value;
  const type = $('availableType').value;
  const filtered = open.filter((t) => matches(t, query) && (type === 'all' || t.type === type));
  $('availableCards').innerHTML = filtered.map((t) => serviceCard(t, isSupport ? 'supportAvailable' : 'idcAvailable')).join('');
  $('availableCount').textContent = `${open.length} disponible${open.length === 1 ? '' : 's'}`;
  $('availableEmpty').classList.toggle('hidden', filtered.length > 0);
  $('availableEmpty').querySelector('strong').textContent = isSupport ? 'No hay tickets por coordinar' : 'No hay servicios disponibles por ahora';
  $('availableEmpty').lastChild.textContent = isSupport
    ? 'Cuando personal administrativo publique un ticket, aparecerá aquí para que ingeniería de apoyo tome la logística.'
    : 'Aparecerán aquí los tickets con ingeniería de apoyo confirmada.';
}
function renderMine() {
  const isSupport = currentUser.role === 'SUPPORT';
  const own = tickets.filter((t) => isSupport ? t.supportEngineerUserId === currentUser.id : t.assignedToUserId === currentUser.id);
  const query = $('mySearch').value;
  const status = $('myStatus').value;
  const shown = own.filter((t) => matches(t, query) && (status === 'all' || t.status === status));
  $('myCards').innerHTML = shown.map((t) => serviceCard(t, isSupport ? 'supportMine' : 'idcMine')).join('');
  $('myCount').textContent = `${own.length} servicio${own.length === 1 ? '' : 's'}`;
  $('myEmpty').classList.toggle('hidden', shown.length > 0);
  $('myEmpty').querySelector('strong').textContent = isSupport ? 'Todavía no tienes tickets de logística' : 'Todavía no tienes servicios asignados';
  $('myEmpty').lastChild.textContent = isSupport ? 'Puedes revisar la bandeja de tickets por coordinar.' : 'Puedes revisar la bandeja de servicios disponibles.';
}
function renderAll() {
  if (!currentUser) return;
  if (currentUser.role === 'HR') renderHR();
  else { renderAvailable(); renderMine(); }
}

function adminDetailHTML(ticket) {
  const idcProfiles = Object.values(profileById).filter((profile) => profile.role === 'IDC');
  return `<div class="form-section" style="margin-top:20px">Administrar ticket</div>
    <div class="form-grid">
      <div class="field"><label for="dAssign">Responsable IDC</label><select id="dAssign"><option value="Disponible" ${!ticket.assignedToUserId ? 'selected' : ''}>Sin IDC asignado</option>${idcProfiles.map((p) => `<option value="${safe(p.employee_code)}" ${ticket.assignedToUserId === p.id ? 'selected' : ''}>${safe(p.employee_code)} · ${safe(p.name)}</option>`).join('')}</select></div>
      <div class="field"><label for="dStatus">Estado</label><select id="dStatus">${STATUSES.map((s) => `<option ${ticket.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
      <div class="field"><label for="dFee">Pago por servicio (MXN)</label><input id="dFee" type="number" min="0" step=".01" value="${ticket.fee ?? ''}" placeholder="Por confirmar"></div>
      <div class="field"><label for="dTravel">Viáticos (MXN)</label><input id="dTravel" type="number" min="0" step=".01" value="${Number(ticket.travel) || 0}"></div>
      <div class="field"><label for="dPayStatus">Estado de pago</label><select id="dPayStatus">${['Por confirmar', 'Acordado', 'Viáticos depositados', 'Pagado'].map((s) => `<option ${ticket.payStatus === s ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
      <div class="field"><label for="dCloseNote">Notas de RR. HH. / cierre</label><textarea id="dCloseNote">${safe(ticket.closeNote)}</textarea></div>
    </div>`;
}
function detailSummaryHTML(ticket) {
  return `<div class="detail-grid">
    <div class="detail-box"><div class="detail-label">Cliente / proyecto</div><div class="detail-value">${safe(ticket.client)}\n${safe(ticket.project || 'Sin proyecto')}\nSITE ID: ${safe(ticket.siteId || '—')}</div></div>
    <div class="detail-box"><div class="detail-label">Estado / asignación</div><div class="detail-value">${statusPill(ticket.status)}<div style="margin-top:8px">${safe(assignedLabel(ticket))}</div></div></div>
    <div class="detail-box"><div class="detail-label">Sitio y cita</div><div class="detail-value">${safe(ticket.site)}\n${safe(ticket.city)}\n${safe(ticket.address || 'Domicilio por confirmar')}\n${formatDate(ticket.date)} · ${safe(ticket.time || 'Por confirmar')}</div></div>
    <div class="detail-box"><div class="detail-label">Contacto</div><div class="detail-value">${safe(ticket.contact || 'Por confirmar')}\n${safe(ticket.phone || 'Teléfono no registrado')}</div></div>
    <div class="detail-box wide"><div class="detail-label">Alcance técnico</div><div class="detail-value">${safe(ticket.scope || 'Sin alcance registrado')}</div></div>
    <div class="detail-box wide"><div class="detail-label">Herramientas y materiales</div><div class="detail-value">${safe(ticket.tools || 'Por confirmar')}</div></div>
    <div class="detail-box"><div class="detail-label">Pago por servicio</div><div class="detail-value">${money(ticket.fee)}</div></div>
    <div class="detail-box"><div class="detail-label">Viáticos acordados</div><div class="detail-value">${money(ticket.travel)} · ${safe(ticket.payStatus)}</div></div>
    <div class="detail-box wide"><div class="detail-label">Notas y condiciones</div><div class="detail-value">${safe(ticket.notes || 'Sin notas')}</div></div>
  </div>`;
}
function showDetail(ticket) {
  selectedTicketId = ticket.id;
  $('detailTicketId').textContent = ticket.id;
  $('detailTitle').textContent = ticket.type;
  $('detailSub').textContent = `${ticket.client} · ${ticket.site} · ${ticket.city}`;
  let body = detailSummaryHTML(ticket);
  const isHR = currentUser.role === 'HR';
  const isOwnIdc = currentUser.role === 'IDC' && ticket.assignedToUserId === currentUser.id;
  if (isHR) {
    body += adminDetailHTML(ticket);
    body += `<div class="form-section" style="margin-top:20px">Evidencias del servicio (${ticket.evidence || 0})</div><div id="evidenceList" class="tools-chip" style="margin:10px 0">Cargando evidencias…</div>`;
    $('detailActions').innerHTML = `<button class="btn btn-secondary" id="detailExport">Exportar ficha</button><button class="btn btn-primary" id="saveAdminDetail">Guardar cambios</button>`;
  } else if (currentUser.role === 'IDC') {
    const checksDisabled = ['Completado', 'Cancelado'].includes(ticket.status) || !isOwnIdc;
    body += `<div class="form-section" style="margin-top:20px">Checklist de campo</div>
      <div class="checklist">${CHECKLIST_ITEMS.map((label, i) => `<label class="checkrow"><input type="checkbox" data-check="${i}" ${(ticket.checklist || {})[String(i)] ? 'checked' : ''} ${checksDisabled ? 'disabled' : ''}>${label}</label>`).join('')}</div>
      <div class="field" style="margin-top:16px"><label for="dIdcNote">Nota de visita / resultado</label><textarea id="dIdcNote" placeholder="Hora de llegada, pruebas, incidencias, pendiente o resultado final…" ${checksDisabled ? 'disabled' : ''}>${safe(ticket.closeNote || '')}</textarea></div>
      <div class="form-section" style="margin-top:20px">Evidencias del servicio</div>
      <p class="small muted">Sube fotografías JPEG/PNG/WebP o documentos PDF. Máximo 10 MB por archivo. El servicio no se podrá cerrar hasta tener al menos una evidencia real.</p>
      <div id="evidenceList" class="tools-chip" style="margin:10px 0">Cargando evidencias…</div>
      ${isOwnIdc && !checksDisabled ? `<div class="field"><label for="dEvidenceFiles">Agregar fotografías o documentos</label><input id="dEvidenceFiles" type="file" multiple accept="image/jpeg,image/png,image/webp,application/pdf"></div><button class="btn btn-secondary" type="button" id="uploadEvidenceBtn">Subir evidencias</button>` : ''}`;
    let actions = '';
    if (!ticket.assignedToUserId && ticket.status === 'Disponible' && ticket.supportEngineerUserId) actions += `<button class="btn btn-primary" id="claimFromDetail">Tomar servicio</button>`;
    if (isOwnIdc && ticket.status === 'Asignado') actions += `<button class="btn btn-primary" id="startFromDetail">Iniciar servicio</button>`;
    if (isOwnIdc && !['Completado', 'Cancelado'].includes(ticket.status)) actions += `<button class="btn btn-secondary" id="saveIdcDetail">Guardar avance</button>`;
    if (isOwnIdc && ticket.status === 'En progreso') actions += `<button class="btn btn-secondary" id="holdFromDetail">Poner en espera</button><button class="btn btn-green" id="completeFromDetail">Cerrar servicio</button>`;
    if (isOwnIdc && ticket.status === 'En espera') actions += `<button class="btn btn-primary" id="resumeFromDetail">Reanudar servicio</button>`;
    $('detailActions').innerHTML = actions || '<span class="small muted">Solo lectura</span>';
  } else {
    body += `<div class="form-section" style="margin-top:20px">Evidencias del servicio</div><div id="evidenceList" class="tools-chip" style="margin:10px 0">Cargando evidencias…</div>`;
    $('detailActions').innerHTML = '<span class="small muted">Solo lectura · coordinación logística</span>';
  }
  const logs = (ticket.logs || []).slice(0, 12);
  body += `<section class="history-panel"><div class="history-head"><strong>Historial del ticket</strong><span class="small muted">${(ticket.logs || []).length} movimiento(s)</span></div><div class="history-list">${logs.length ? logs.map((entry) => `<div class="history-item"><span class="history-dot"></span><div><div class="history-title">${safe(entry.title || 'Movimiento')}</div><div class="history-desc">${safe(entry.desc || '')}</div><div class="history-date">${safe(formatLogDate(entry.at))}</div></div></div>`).join('') : '<div class="muted small">Todavía no hay movimientos registrados.</div>'}</div></section>`;
  $('detailContent').innerHTML = body;
  $('detailFoot').textContent = isHR ? 'Los permisos de administración se validan en Supabase.' : 'Los cambios y las evidencias se validan en el servidor.';
  $('detailOverlay').classList.add('open');
  bindDetailActions(ticket, isHR, isOwnIdc);
  if ($('evidenceList')) void loadTicketEvidence(ticket);
}
function openDetail(code) {
  const ticket = ticketByCode(code);
  if (!ticket) return;
  showDetail(ticket);
}
function closeDetail() {
  $('detailOverlay').classList.remove('open');
  selectedTicketId = null;
}
async function loadTicketEvidence(ticket) {
  const mount = $('evidenceList');
  if (!mount || !supabaseClient) return;
  const { data, error } = await supabaseClient.from('ticket_evidence')
    .select('id, storage_path, original_name, content_type, size_bytes, created_at')
    .eq('ticket_id', ticket.dbId).order('created_at', { ascending: false });
  if (selectedTicketId !== ticket.id || !$('evidenceList')) return;
  if (error) {
    $('evidenceList').textContent = `No se pudieron consultar las evidencias: ${error.message}`;
    return;
  }
  if (!data?.length) {
    $('evidenceList').textContent = 'Todavía no se han subido evidencias.';
    return;
  }
  const links = await Promise.all(data.map(async (item) => {
    const result = await supabaseClient.storage.from('ticket-evidence').createSignedUrl(item.storage_path, 300);
    return { ...item, signedUrl: result.data?.signedUrl || null };
  }));
  if (selectedTicketId !== ticket.id || !$('evidenceList')) return;
  $('evidenceList').innerHTML = links.map((item) => {
    const size = item.size_bytes < 1024 * 1024 ? `${Math.max(1, Math.round(item.size_bytes / 1024))} KB` : `${(item.size_bytes / 1024 / 1024).toFixed(1)} MB`;
    return `<div style="display:flex;justify-content:space-between;gap:10px;align-items:center;margin:5px 0"><span>${safe(item.original_name)} <span class="muted">(${size})</span></span>${item.signedUrl ? `<a href="${safe(item.signedUrl)}" target="_blank" rel="noopener noreferrer">Abrir</a>` : '<span class="muted">Sin acceso</span>'}</div>`;
  }).join('');
}
async function bindDetailActions(ticket, isHR, isOwnIdc) {
  if (isHR) {
    $('detailExport').addEventListener('click', () => exportOne(ticket));
    $('saveAdminDetail').addEventListener('click', () => saveAdminDetail(ticket));
    return;
  }
  if (currentUser.role !== 'IDC') return;
  const claim = $('claimFromDetail');
  if (claim) claim.addEventListener('click', () => claimIdcTicket(ticket));
  const start = $('startFromDetail');
  if (start) start.addEventListener('click', () => changeMyStatus(ticket, 'En progreso'));
  const resume = $('resumeFromDetail');
  if (resume) resume.addEventListener('click', () => changeMyStatus(ticket, 'En progreso'));
  const save = $('saveIdcDetail');
  if (save) save.addEventListener('click', () => saveProgress(ticket));
  const hold = $('holdFromDetail');
  if (hold) hold.addEventListener('click', async () => {
    if (await saveProgress(ticket, { keepOpen: true })) await changeMyStatus(ticket, 'En espera');
  });
  const complete = $('completeFromDetail');
  if (complete) complete.addEventListener('click', async () => {
    if (await saveProgress(ticket, { keepOpen: true })) await changeMyStatus(ticket, 'Completado');
  });
  const upload = $('uploadEvidenceBtn');
  if (upload && isOwnIdc) upload.addEventListener('click', () => uploadEvidence(ticket));
}
function checklistFromUI() {
  const checklist = {};
  document.querySelectorAll('[data-check]').forEach((checkbox) => { checklist[checkbox.dataset.check] = checkbox.checked; });
  return checklist;
}
async function saveProgress(ticket, { keepOpen = false } = {}) {
  if (currentUser?.role !== 'IDC' || ticket.assignedToUserId !== currentUser.id) return false;
  const checklist = checklistFromUI();
  const note = $('dIdcNote')?.value.trim() || '';
  const { error } = await supabaseClient.rpc('save_my_ticket_progress', {
    p_ticket_id: ticket.dbId, p_checklist: checklist, p_close_note: note
  });
  if (error) { toast(`No se pudo guardar el avance: ${error.message}`); return false; }
  await loadTickets({ silent: true });
  const updated = ticketByCode(ticket.id);
  if (keepOpen && updated) showDetail(updated); else closeDetail();
  toast('Avance guardado en Supabase.');
  return true;
}
async function changeMyStatus(ticket, status) {
  if (currentUser?.role !== 'IDC' || ticket.assignedToUserId !== currentUser.id) return;
  const { error } = await supabaseClient.rpc('set_my_ticket_status', { p_ticket_id: ticket.dbId, p_status: status });
  if (error) { toast(error.message || 'No se pudo actualizar el estado.'); return; }
  await loadTickets({ silent: true });
  closeDetail();
  toast(status === 'Completado' ? 'Servicio cerrado con checklist y evidencia validados.' : `Estado actualizado: ${status}.`);
}
async function claimSupportTicket(code) {
  if (currentUser?.role !== 'SUPPORT') return;
  const ticket = ticketByCode(code);
  if (!ticket) return;
  const { error } = await supabaseClient.rpc('claim_support_ticket', { p_ticket_id: ticket.dbId });
  if (error) { toast(error.message || 'No se pudo tomar la logística.'); await loadTickets({ silent: true }); return; }
  await loadTickets({ silent: true });
  goPage('myTickets');
  toast('Logística asignada. El ticket ya puede aparecer a los IDC.');
}
async function claimIdcTicket(ticket) {
  if (currentUser?.role !== 'IDC') return;
  const { error } = await supabaseClient.rpc('claim_idc_ticket', { p_ticket_id: ticket.dbId });
  if (error) { toast(error.message || 'No se pudo tomar el servicio.'); await loadTickets({ silent: true }); return; }
  await loadTickets({ silent: true });
  closeDetail();
  goPage('myTickets');
  toast('Servicio asignado a tu perfil. Revisa los datos antes de acudir.');
}
async function saveAdminDetail(ticket) {
  if (currentUser?.role !== 'HR') return;
  const selectedCode = $('dAssign').value;
  const selectedProfile = selectedCode === 'Disponible' ? null : profileByCode[selectedCode];
  if (selectedCode !== 'Disponible' && (!selectedProfile || selectedProfile.role !== 'IDC')) {
    toast('Selecciona un perfil IDC válido.'); return;
  }
  const selectedStatus = $('dStatus').value;
  let finalStatus = selectedStatus;
  if (!selectedProfile && !['Disponible', 'Cancelado'].includes(finalStatus)) {
    toast('Asigna un IDC antes de seleccionar ese estado.'); return;
  }
  if (selectedProfile && finalStatus === 'Disponible') finalStatus = 'Asignado';
  const feeRaw = $('dFee').value;
  const travelRaw = $('dTravel').value;
  if ((feeRaw !== '' && (!Number.isFinite(Number(feeRaw)) || Number(feeRaw) < 0))
    || travelRaw === '' || !Number.isFinite(Number(travelRaw)) || Number(travelRaw) < 0) {
    toast('Revisa los importes de pago y viáticos.'); return;
  }
  const payload = {
    assigned_to: selectedProfile?.id || null,
    status: finalStatus,
    fee_mxn: feeRaw === '' ? null : Number(feeRaw),
    travel_mxn: Number(travelRaw),
    pay_status: $('dPayStatus').value,
    close_note: $('dCloseNote').value.trim(),
    logs: [newLog('Ticket actualizado por personal administrativo', `Estado: ${finalStatus}. Responsable: ${selectedProfile ? selectedProfile.employee_code : 'Sin IDC asignado'}.`), ...(ticket.logs || [])]
  };
  const { error } = await supabaseClient.from('tickets').update(payload).eq('id', ticket.dbId);
  if (error) { toast(`No se pudo guardar el ticket: ${error.message}`); return; }
  await loadTickets({ silent: true });
  closeDetail();
  toast('Ticket actualizado en Supabase.');
}
async function uploadEvidence(ticket) {
  if (currentUser?.role !== 'IDC' || ticket.assignedToUserId !== currentUser.id) return;
  const input = $('dEvidenceFiles');
  const files = [...(input?.files || [])];
  if (!files.length) { toast('Selecciona al menos una fotografía o PDF.'); return; }
  if (files.some((file) => !ALLOWED_EVIDENCE_TYPES.includes(file.type) || file.size <= 0 || file.size > MAX_EVIDENCE_SIZE)) {
    toast('Solo se aceptan JPEG, PNG, WebP o PDF de hasta 10 MB por archivo.'); return;
  }
  const button = $('uploadEvidenceBtn');
  button.disabled = true;
  button.textContent = 'Subiendo…';
  let uploaded = 0;
  try {
    for (const file of files) {
      const cleanName = file.name.normalize('NFKD').replace(/[^a-zA-Z0-9._-]/g, '_').slice(-100) || 'evidencia';
      const path = `${ticket.dbId}/${currentUser.id}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}-${cleanName}`;
      const { error: storageError } = await supabaseClient.storage.from('ticket-evidence').upload(path, file, {
        cacheControl: '3600', upsert: false, contentType: file.type
      });
      if (storageError) throw storageError;
      const { error: rowError } = await supabaseClient.from('ticket_evidence').insert({
        ticket_id: ticket.dbId,
        uploader_id: currentUser.id,
        storage_path: path,
        original_name: file.name,
        content_type: file.type,
        size_bytes: file.size
      });
      if (rowError) {
        await supabaseClient.storage.from('ticket-evidence').remove([path]);
        throw rowError;
      }
      uploaded += 1;
    }
    await loadTickets({ silent: true });
    const updated = ticketByCode(ticket.id);
    toast(`${uploaded} evidencia(s) subida(s) correctamente.`);
    if (updated) showDetail(updated); else closeDetail();
  } catch (error) {
    toast(`No se pudieron subir todas las evidencias: ${error.message || 'error desconocido'}`);
    await loadTickets({ silent: true });
  } finally {
    const currentButton = $('uploadEvidenceBtn');
    if (currentButton) { currentButton.disabled = false; currentButton.textContent = 'Subir evidencias'; }
  }
}
function exportCSV(filename, rows) {
  const quote = (value) => {
    let text = String(value ?? '');
    if (/^[\s]*[=+@\-]/.test(text)) text = "'" + text;
    return `"${text.replace(/"/g, '""')}"`;
  };
  const content = '\ufeff' + rows.map((row) => row.map(quote).join(',')).join('\r\n');
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = filename;
  document.body.appendChild(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('CSV exportado.');
}
function exportTickets() {
  if (currentUser?.role !== 'HR') return;
  exportCSV('fieldconnect_tickets.csv', [['Ticket', 'SITE ID', 'Cliente', 'Sitio', 'Ciudad', 'Tipo', 'Fecha', 'Hora', 'Estado', 'IDC asignado', 'Ingeniería de apoyo', 'Alcance', 'Herramientas', 'Pago MXN', 'Viáticos MXN', 'Estado pago', 'Nota cierre'],
    ...tickets.map((t) => [t.id, t.siteId, t.client, t.site, t.city, t.type, t.date, t.time, t.status, t.assignedTo, t.supportEngineerId, t.scope, t.tools, t.fee, t.travel, t.payStatus, t.closeNote])]);
}
function exportOne(ticket) {
  exportCSV(`${ticket.id}_reporte.csv`, [['Campo', 'Valor'], ['Ticket', ticket.id], ['Cliente', ticket.client], ['Sitio', ticket.site], ['Ciudad', ticket.city], ['SITE ID', ticket.siteId], ['Servicio', ticket.type], ['Fecha', ticket.date], ['Hora', ticket.time], ['Estado', ticket.status], ['IDC', ticket.assignedTo], ['Ingeniería de apoyo', ticket.supportEngineerId], ['Alcance', ticket.scope], ['Herramientas', ticket.tools], ['Pago', ticket.fee], ['Viáticos', ticket.travel], ['Estado de pago', ticket.payStatus], ['Checklist', JSON.stringify(ticket.checklist || {})], ['Evidencias registradas', ticket.evidence], ['Nota de cierre', ticket.closeNote]]);
}
function resetTicketForm() {
  $('ticketForm').reset();
  $('fDate').value = todayLocalISO();
  $('fDate').min = todayLocalISO();
  $('fTime').value = '09:00';
  $('fTravel').value = '0';
}
async function createTicket(event) {
  event.preventDefault();
  if (currentUser?.role !== 'HR') return;
  const value = (id) => $(id).value.trim();
  const date = value('fDate');
  if (date < todayLocalISO()) { toast('La fecha del servicio no puede estar en el pasado.'); $('fDate').focus(); return; }
  const feeRaw = value('fFee');
  const travelRaw = value('fTravel');
  if ((feeRaw !== '' && (!Number.isFinite(Number(feeRaw)) || Number(feeRaw) < 0))
    || (travelRaw !== '' && (!Number.isFinite(Number(travelRaw)) || Number(travelRaw) < 0))) {
    toast('Revisa los importes de pago y viáticos.'); return;
  }
  const ticketCode = `FCG-${new Date().getFullYear()}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
  const row = {
    ticket_code: ticketCode,
    site_id: value('fSiteId') || null,
    project: value('fProject') || null,
    client: value('fClient'), site: value('fSite'), city: value('fCity'),
    address: value('fAddress') || null, contact: value('fContact'), phone: value('fPhone') || null,
    service_type: value('fType'), service_date: date, service_time: value('fTime'), priority: value('fPriority'),
    status: 'Disponible', assigned_to: null, support_engineer_id: null,
    scope: value('fScope'), tools: value('fTools') || null, notes: value('fNotes') || null,
    fee_mxn: feeRaw === '' ? null : Number(feeRaw), travel_mxn: travelRaw === '' ? 0 : Number(travelRaw),
    pay_status: value('fPayStatus'), checklist: {}, evidence_count: 0, close_note: '',
    logs: [newLog('Ticket publicado por personal administrativo', 'Disponible para que ingeniería de apoyo tome la coordinación logística.')],
    created_by: currentUser.id
  };
  const button = $('ticketForm').querySelector('button[type="submit"]');
  button.disabled = true;
  button.textContent = 'Publicando…';
  const { error } = await supabaseClient.from('tickets').insert(row);
  button.disabled = false;
  button.textContent = 'Crear y publicar ticket';
  if (error) { toast(`No se pudo publicar: ${error.message}`); return; }
  resetTicketForm();
  await loadTickets({ silent: true });
  toast(`Se publicó ${ticketCode} para ingeniería de apoyo.`);
  goPage('tickets');
}

function bindEvents() {
  $('pickHR').addEventListener('click', () => setSelectedRole('HR'));
  $('pickSupport').addEventListener('click', () => setSelectedRole('SUPPORT'));
  $('pickIDC').addEventListener('click', () => setSelectedRole('IDC'));
  $('loginForm').addEventListener('submit', handleLogin);
  $('logoutBtn').addEventListener('click', () => { void handleLogout(); });
  $('ticketForm').addEventListener('submit', (event) => { void createTicket(event); });
  $('resetFormBtn').addEventListener('click', resetTicketForm);
  $('fDate').min = todayLocalISO();
  $('hrSearch').addEventListener('input', renderHR);
  $('hrStatusFilter').addEventListener('change', renderHR);
  $('allSearch').addEventListener('input', renderHR);
  $('allStatus').addEventListener('change', renderHR);
  $('allType').addEventListener('change', renderHR);
  $('availableSearch').addEventListener('input', renderAvailable);
  $('availableType').addEventListener('change', renderAvailable);
  $('mySearch').addEventListener('input', renderMine);
  $('myStatus').addEventListener('change', renderMine);
  $('exportBtn').addEventListener('click', exportTickets);
  $('detailOverlay').addEventListener('click', (event) => { if (event.target === $('detailOverlay')) closeDetail(); });
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeDetail(); });
  document.addEventListener('click', (event) => {
    const pageButton = event.target.closest('[data-page]');
    if (pageButton) { goPage(pageButton.dataset.page); return; }
    if (event.target.closest('[data-new]')) { goPage('new'); return; }
    const detailButton = event.target.closest('[data-detail]');
    if (detailButton) { openDetail(detailButton.dataset.detail); return; }
    const supportClaim = event.target.closest('[data-support-claim]');
    if (supportClaim) { void claimSupportTicket(supportClaim.dataset.supportClaim); return; }
    const idcClaim = event.target.closest('[data-claim]');
    if (idcClaim) { const ticket = ticketByCode(idcClaim.dataset.claim); if (ticket) void claimIdcTicket(ticket); return; }
    const statusButton = event.target.closest('[data-status][data-ticket]');
    if (statusButton) {
      const ticket = ticketByCode(statusButton.dataset.ticket);
      if (ticket) void changeMyStatus(ticket, statusButton.dataset.status);
      return;
    }
    const closeButton = event.target.closest('[data-close]');
    if (closeButton) closeDetail();
    const row = event.target.closest('tr[data-id]');
    if (row && !event.target.closest('button') && currentUser?.role === 'HR') openDetail(row.dataset.id);
  });
}
bindEvents();
(function boot() {
  const config = window.FIELD_CONNECT_SUPABASE || {};
  const valid = /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(config.url || '')
    && typeof config.publishableKey === 'string' && config.publishableKey.length > 20
    && !String(config.publishableKey).includes('TU_CLAVE');
  if (!window.supabase?.createClient) {
    loginError('No se pudo cargar el cliente Supabase. Comprueba tu conexión a internet y vuelve a cargar.');
    return;
  }
  if (!valid) {
    setSelectedRole('HR');
    loginError('Falta configurar Supabase: edita assets/js/supabase-config.js con la URL de proyecto y la clave publishable.');
    return;
  }
  supabaseClient = window.supabase.createClient(config.url, config.publishableKey, {
    auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: true }
  });
  supabaseClient.auth.getSession().then(async ({ data, error }) => {
    if (error) { loginError(`No se pudo recuperar la sesión: ${error.message}`); return; }
    if (data.session?.user) {
      try { await enterApp(data.session.user); }
      catch (err) { loginError(err?.message || 'No se pudo restaurar el acceso.'); }
    } else setSelectedRole('HR');
  }).catch((error) => loginError(error?.message || 'No se pudo conectar con Supabase.'));
})();
