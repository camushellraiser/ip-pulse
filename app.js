"use strict";

const TIMEOUT_MS = 20_000;
const POLLING_MS = 15_000;
const $ = (selector) => document.querySelector(selector);
let client = null;
let currentUser = null;
let channel = null;
let devices = [];
let events = [];
let serverOk = true;
let refreshing = false;
let reloadTimer = null;
let lastLoaded = 0;
let toastTimer = null;

const escapeHTML = (value) => String(value ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;")
  .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const ipText = (ip) => ip || "No detectada";
const date = (value) => value ? new Date(value) : null;
const isOnline = (device) => !!device?.last_seen && (Date.now() - date(device.last_seen).getTime()) < TIMEOUT_MS;
const shortDate = (value) => value ? date(value).toLocaleString("es-MX", {
  dateStyle: "short", timeStyle: "short",
}) : "Nunca";
const age = (value) => {
  if (!value) return "Sin reportes todavía";
  const ms = Math.max(0, Date.now() - date(value).getTime());
  const sec = Math.floor(ms / 1000);
  if (sec < 5) return "Ahora mismo";
  if (sec < 60) return `Hace ${sec} s`;
  if (sec < 3600) return `Hace ${Math.floor(sec / 60)} min`;
  if (sec < 86400) return `Hace ${Math.floor(sec / 3600)} h`;
  return shortDate(value);
};

function notify(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("visible"), 2400);
}
function connected(value) {
  serverOk = value;
  $("#cloud-alert").classList.toggle("hidden", value);
  const indicator = $("#connection-indicator");
  indicator.classList.toggle("live", value);
  indicator.classList.toggle("error", !value);
  $("#connection-text").textContent = value ? "En vivo" : "Sin acceso a nube";
}
function deviceState(device) {
  if (!serverOk) return "unknown";
  return isOnline(device) ? "online" : "offline";
}
function renderSummary() {
  const onlineCount = devices.filter((device) => deviceState(device) === "online").length;
  const targetCount = devices.length || 2;
  const offlineCount = targetCount - onlineCount;
  const nas = devices.find((device) => device.device_type === "nas");
  const plexDown = !!nas && deviceState(nas) === "online" && nas.plex_online === false;
  const state = !serverOk ? "standby" : onlineCount === 0 ? "offline" :
    (offlineCount > 0 || plexDown ? "partial" : "online");
  const messages = {
    online: ["Todos conectados", nas ? "Computadoras, NAS y Plex funcionando." : "Tus dos computadoras están enviando señales."],
    partial: [plexDown && !offlineCount ? "Plex requiere atención" : "Conexión parcial",
      plexDown ? (offlineCount ? `Hay ${offlineCount} dispositivos sin señal y Plex no responde.` :
      "El NAS está encendido, pero Plex no responde.") : `${offlineCount} equipo(s) dejaron de enviar señales.`],
    offline: ["Todos desconectados", "Ningún dispositivo está enviando señales."],
    standby: ["Estado desconocido", "No se pudo confirmar el estado de tus equipos."],
  };
  const [name, description] = messages[state];
  $("#general-dot").className = `big-dot ${state}`;
  $("#general-status").textContent = devices.length ? name : "Esperando dispositivos";
  $("#general-description").textContent = devices.length ? description : "Configura tus dispositivos para recibir señales.";
  $("#online-count").textContent = `${onlineCount} / ${targetCount} ONLINE`;
  $("#online-progress").style.width = `${devices.length ? onlineCount / targetCount * 100 : 0}%`;

  const ips = [...new Set(devices.map((d) => d.public_ip).filter(Boolean))];
  $("#shared-public-ip").textContent = ips.length === 1 ? ips[0] : ips.length > 1 ? "IPs diferentes" : "—";
  $("#router-description").textContent = ips.length > 1 ? "Verifica la conexión" :
    nas ? "Red compartida · PCs y NAS" : "Ambos equipos, mismo router";
  $("#latest-change").textContent = events.length ? age(events[0].changed_at) : "—";
  $("#latest-change-time").textContent = events.length
    ? `Registrado ${shortDate(events[0].changed_at)}` : "Sin cambios registrados";
}
const computerIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/></svg>`;
const nasIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 7h10M7 12h10M7 17h5"/><circle cx="17" cy="17" r="1"/></svg>`;
function plexStatus(device, state) {
  if (state === "unknown" || state === "offline") return ["unknown", "SIN VERIFICAR"];
  if (device.plex_online === true) return ["online", "ONLINE"];
  if (device.plex_online === false) return ["offline", "OFFLINE"];
  return ["unknown", "SIN REVISAR"];
}
function renderDevices() {
  const container = $("#device-grid");
  if (!devices.length) {
    container.innerHTML = `<div class="empty-state">Aún no hay dispositivos configurados. Ejecuta el SQL de alta.</div>`;
    return;
  }
  container.innerHTML = devices.map((device, index) => {
    const state = deviceState(device);
    const stateLabel = state === "online" ? "ONLINE" : state === "offline" ? "OFFLINE" : "SIN VERIFICAR";
    const lastSeen = state === "unknown" ? "Sin verificar" : age(device.last_seen);
    const isNas = device.device_type === "nas";
    const name = escapeHTML(device.name);
    const publicIP = escapeHTML(ipText(device.public_ip));
    const localIP = escapeHTML(ipText(device.local_ip));
    const [plexState, plexLabel] = plexStatus(device, state);
    const plexSection = isNas ? `<div class="service-health">
      <div class="service-title"><span class="plex-mark">▶</span><div><strong>PLEX MEDIA SERVER</strong><small>${state === "offline" ? "NAS sin señal: no es posible comprobar Plex" : "Disponibilidad local del servicio"}</small></div></div>
      <span class="status-pill ${plexState}">${plexLabel}</span>
    </div>` : "";
    return `<article class="device-card is-${state}">
      <div class="device-top">
        <div class="device-identity"><div class="computer-symbol">${isNas ? nasIcon : computerIcon}</div><div><h3>${name}</h3><span>${isNas ? "SYNOLOGY NAS" : `EQUIPO 0${index + 1} · WINDOWS`}</span></div></div>
        <span class="status-pill ${state}">${stateLabel}</span>
      </div><div class="card-divider"></div>
      <div class="device-ips">
        <div><span class="ip-label">IP PÚBLICA</span><div class="ip-value-wrap"><span class="ip-value">${publicIP}</span><button class="copy-btn" data-ip="${escapeHTML(device.public_ip || '')}" ${device.public_ip ? '' : 'disabled'} title="Copiar IP pública">⧉</button></div></div>
        <div><span class="ip-label">IP PRIVADA (LAN)</span><div class="ip-value-wrap"><span class="ip-value">${localIP}</span><button class="copy-btn" data-ip="${escapeHTML(device.local_ip || '')}" ${device.local_ip ? '' : 'disabled'} title="Copiar IP local">⧉</button></div></div>
      </div>${plexSection}
      <div class="device-bottom"><span>ÚLTIMA SEÑAL</span><strong class="${state === 'offline' ? 'offline-txt' : ''}">${escapeHTML(lastSeen)}</strong></div>
    </article>`;
  }).join("");
}
function renderHistory() {
  const container = $("#history-list");
  if (!events.length) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">◷</div>Los cambios de IP aparecerán aquí automáticamente.</div>`;
    return;
  }
  container.innerHTML = events.map((entry) => {
    const device = devices.find((d) => d.id === entry.device_id);
    const initial = !entry.old_public_ip && !entry.old_local_ip;
    const publicChanged = entry.old_public_ip !== entry.new_public_ip;
    const oldIP = publicChanged ? entry.old_public_ip : entry.old_local_ip;
    const newIP = publicChanged ? entry.new_public_ip : entry.new_local_ip;
    const kind = initial ? "Primera conexión" : publicChanged ? "Cambio de IP pública" : "Cambio de IP privada";
    return `<div class="history-item"><span class="event-icon">${initial ? '●' : '↗'}</span>
      <div><div class="event-name">${escapeHTML(device?.name || entry.device_id)}</div><div class="event-desc">${kind}</div></div>
      <div class="history-ips">${escapeHTML(oldIP || 'Sin registro')} <span class="arrow">→</span> ${escapeHTML(newIP || 'No detectada')}</div>
      <div class="event-time">${escapeHTML(shortDate(entry.changed_at))}</div></div>`;
  }).join("");
}
function renderClock() {
  const now = new Date();
  $("#today").textContent = now.toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long" });
  $("#clock").textContent = now.toLocaleTimeString("es-MX", {hour12:false});
}
function renderDynamic() { renderClock(); renderSummary(); renderDevices(); }
async function loadData() {
  if (!client || !currentUser || refreshing) return;
  refreshing = true;
  try {
    if (!navigator.onLine) throw new Error("Sin conexión a Internet");
    const [deviceResp, historyResp] = await Promise.all([
      client.from("devices").select("id,name,device_type,public_ip,local_ip,last_seen,ip_changed_at,plex_online,plex_checked_at").order("id"),
      client.from("ip_history").select("id,device_id,old_public_ip,new_public_ip,old_local_ip,new_local_ip,changed_at").order("changed_at", {ascending:false}).limit(30),
    ]);
    if (deviceResp.error) throw deviceResp.error;
    if (historyResp.error) throw historyResp.error;
    if (!currentUser) return; // Evita aplicar una consulta que terminó tras cerrar sesión.
    devices = deviceResp.data || [];
    events = historyResp.data || [];
    lastLoaded = Date.now();
    connected(true);
    renderHistory();
    renderDynamic();
  } catch (error) {
    console.warn("IP Pulse: error consultando Supabase", error);
    connected(false);
    renderDynamic();
  } finally { refreshing = false; }
}
function scheduleReload() {
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(() => { void loadData(); }, 250);
}
function stopRealtime() {
  if (channel && client) { void client.removeChannel(channel); channel = null; }
}
function startRealtime() {
  stopRealtime();
  channel = client.channel("ip-pulse-live")
    .on("postgres_changes", {event:"*", schema:"public", table:"devices"}, scheduleReload)
    .on("postgres_changes", {event:"INSERT", schema:"public", table:"ip_history"}, scheduleReload)
    .subscribe((status) => {
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        // La lectura por polling continúa funcionando aunque el socket se interrumpa.
        console.warn("IP Pulse: canal Realtime interrumpido", status);
      }
    });
}
async function handleAuth(session) {
  const user = session?.user || null;
  const isLogged = Boolean(user);
  const previousUserId = currentUser?.id || null;
  currentUser = user;
  $("#login-section").classList.toggle("hidden", isLogged);
  $("#dashboard").classList.toggle("hidden", !isLogged);
  $("#sign-out").classList.toggle("hidden", !isLogged);
  if (!isLogged) {
    stopRealtime(); devices = []; events = []; connected(false);
  } else if (previousUserId !== user.id) {
    startRealtime(); await loadData();
  }
}
async function initialize() {
  const config = window.IP_PULSE_CONFIG;
  if (!config || !config.supabaseUrl?.startsWith("https://") || !config.publishableKey || !window.supabase) {
    $("#login-message").textContent = "Falta configurar Supabase en config.js (o no se cargó la librería).";
    connected(false);
    return;
  }
  client = window.supabase.createClient(config.supabaseUrl, config.publishableKey, {
    auth: {persistSession:true, autoRefreshToken:true, detectSessionInUrl:false},
  });
  client.auth.onAuthStateChange((_event, session) => {
    setTimeout(() => { void handleAuth(session); }, 0);
  });
  const {data} = await client.auth.getSession();
  await handleAuth(data.session);
  if (!data.session) connected(true);
}
$("#login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!client) return;
  const button = $("#login-button");
  const message = $("#login-message");
  message.textContent = ""; button.disabled = true;
  try {
    const {error} = await client.auth.signInWithPassword({
      email: $("#email").value.trim(), password: $("#password").value,
    });
    if (error) throw error;
    $("#password").value = "";
  } catch (error) {
    message.textContent = "No fue posible iniciar sesión. Comprueba tu correo y contraseña.";
    console.warn(error);
  } finally { button.disabled = false; }
});
$("#sign-out").addEventListener("click", async () => {if (client) await client.auth.signOut();});
$("#device-grid").addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-ip]");
  if (!button || !button.dataset.ip) return;
  try { await navigator.clipboard.writeText(button.dataset.ip); notify("IP copiada al portapapeles"); }
  catch { notify("No se pudo copiar esta IP"); }
});
window.addEventListener("online", () => { void loadData(); });
window.addEventListener("offline", () => { connected(false); renderDynamic(); });
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && currentUser) { void loadData(); }
});
setInterval(() => {
  if (!currentUser) return;
  if (!navigator.onLine) connected(false);
  else if (Date.now() - lastLoaded > 40_000) connected(false);
  renderDynamic();
}, 1000);
setInterval(() => { if (currentUser && !document.hidden) void loadData(); }, POLLING_MS);
renderClock();
void initialize();
