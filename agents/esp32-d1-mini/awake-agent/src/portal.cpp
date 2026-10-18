#include "portal.h"

#include <DNSServer.h>
#include <WebServer.h>
#include <WiFi.h>

#include "log.h"
#include "status_led.h"
#include "version.h"
#include "watchdog.h"

namespace {

constexpr const char* AP_PASSWORD = "awake-setup";
constexpr uint32_t IDLE_RESTART_MS = 10UL * 60 * 1000;

// The setup page: plain HTML + a little JavaScript, everything inline (no internet on the setup network).
const char PAGE[] PROGMEM = R"HTML(<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Awake agent setup</title>
<style>
:root{color-scheme:light dark;--bg:#efebe4;--card:#fbf9f5;--fg:#1f1d1a;--muted:#6f685f;--line:#d9d1c5;--acc:#6f6450;--err:#a85c52}
@media(prefers-color-scheme:dark){:root{--bg:#12100d;--card:#1f1b17;--fg:#ece6dc;--muted:#9a9083;--line:#3a332c;--acc:#cdbb98;--err:#dc9b91}}
*{box-sizing:border-box}body{margin:0;font:15px/1.45 system-ui,sans-serif;background:var(--bg);color:var(--fg)}
main{max-width:560px;margin:auto;padding:16px}h1{font:600 1.5rem Georgia,serif;margin:8px 0 4px}
p.sub{color:var(--muted);margin:0 0 16px}section{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:16px;margin-bottom:12px}
h2{font-size:.8rem;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin:0 0 10px}
label{display:block;font-weight:600;font-size:.85rem;margin:10px 0 4px}small{display:block;color:var(--muted);font-size:.78rem;margin-top:3px}
input,select{width:100%;padding:10px 12px;border:1px solid var(--line);border-radius:12px;background:transparent;color:inherit;font:inherit}
input[type=checkbox]{width:auto;margin-right:6px}.row{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.out{border:1px dashed var(--line);border-radius:14px;padding:10px 12px;margin-top:10px}
button{font:600 .95rem system-ui;border:0;border-radius:12px;padding:12px 16px;cursor:pointer}
.primary{background:var(--acc);color:var(--bg);width:100%}.ghost{background:transparent;color:var(--acc);border:1px solid var(--line)}
.del{float:right;background:none;color:var(--err);padding:2px 6px}#msg{margin:12px 0;font-weight:600}.err{color:var(--err)}
</style></head><body><main>
<h1>Awake agent</h1><p class="sub" id="fw"></p>
<form id="f">
<section><h2>Wi-Fi</h2>
<label for="ssid">Network</label><input id="ssid" list="nets" required maxlength="32" autocomplete="off"><datalist id="nets"></datalist>
<label for="pass">Password</label><input id="pass" type="password" maxlength="64" autocomplete="off"><small id="passHint">Empty for an open network.</small>
</section>
<section><h2>Awake server</h2>
<label for="server">Address</label><input id="server" required placeholder="wss://awake.example.com/agent" autocapitalize="none">
<label for="token">Agent token</label><input id="token" autocapitalize="none" autocomplete="off" placeholder="awk_…"><small id="tokenHint">Shown once when the agent is created in the web app (house → Agents → New agent).</small>
</section>
<section><h2>Board</h2>
<div class="row"><div><label for="wol">Wake-on-LAN port</label><input id="wol" type="number" min="1" max="65535" value="9"></div>
<div><label for="led">Status LED</label><select id="led"></select></div></div>
<label><input id="ledLow" type="checkbox">LED lights with LOW</label>
</section>
<section><h2>Outputs (relays)</h2><small>Name as in the web app; GPIO numbers as printed on the board (IO16 → 16). Most relay modules switch on with LOW.</small>
<div id="outs"></div><p><button type="button" class="ghost" id="addB">+ Button</button> <button type="button" class="ghost" id="addS">+ Switch</button></p>
</section>
<p id="msg"></p><button class="primary">Save and restart</button>
</form></main>
<script>
let PINS=[];const $=id=>document.getElementById(id);
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
const opt=(v,t,s)=>`<option value="${esc(v)}"${s?' selected':''}>${esc(t)}</option>`;
const pinSel=(v,none)=>(none?opt(-1,'none',v<0):'')+PINS.map(p=>opt(p,'GPIO '+p,p==v)).join('');
function addOut(o){const d=document.createElement('div');d.className='out';d.dataset.mode=o.mode;
const b=o.mode=='button';d.innerHTML=`<button type="button" class="del">remove</button><b>${b?'Button':'Switch'}</b>
<label>Name</label><input class="id" value="${esc(o.id||'')}" required pattern="[a-z0-9][a-z0-9_-]{0,31}" placeholder="${b?'pc-power':'lamp'}">
<div class="row"><div><label>Relay GPIO</label><select class="pin">${pinSel(o.pin??-1,false)}</select></div>
<div><label>&nbsp;</label><label><input class="low" type="checkbox"${o.low!==false?' checked':''}>On with LOW</label></div></div>`+
(b?`<div class="row"><div><label>Press (ms)</label><input class="short" type="number" value="${o.short||300}"></div>
<div><label>Long press (ms)</label><input class="long" type="number" value="${o.long??5000}"><small>0 = none</small></div></div>`
:`<div class="row"><div><label>Local push button</label><select class="input">${pinSel(o.input??-1,true)}</select></div>
<div><label>&nbsp;</label><label><input class="initial" type="checkbox"${o.initial?' checked':''}>On at power-up</label></div></div>`);
d.querySelector('.del').onclick=()=>d.remove();$('outs').append(d)}
$('addB').onclick=()=>addOut({mode:'button'});$('addS').onclick=()=>addOut({mode:'switch'});
fetch('/api/config').then(r=>r.json()).then(j=>{PINS=j.pins;$('fw').textContent=j.fw+' · '+j.mac;
$('nets').innerHTML=j.networks.map(n=>opt(n,n)).join('');const c=j.config;
$('led').innerHTML=pinSel(c?c.led:2,true);
if(c){$('ssid').value=c.ssid;$('server').value=c.server;$('wol').value=c.wol;$('ledLow').checked=c.ledLow;
$('passHint').textContent='Leave empty to keep the saved one.';$('token').placeholder='(saved: leave empty to keep it)';c.outputs.forEach(addOut)}});
$('f').onsubmit=e=>{e.preventDefault();const outs=[...document.querySelectorAll('.out')].map(d=>{const q=s=>d.querySelector(s);
const o={id:q('.id').value.trim(),mode:d.dataset.mode,pin:+q('.pin').value,low:q('.low').checked};
if(o.mode=='button'){o.short=+q('.short').value;o.long=+q('.long').value}else{o.input=+q('.input').value;o.initial=q('.initial').checked}return o});
const body={ssid:$('ssid').value,pass:$('pass').value,server:$('server').value.trim(),token:$('token').value.trim(),
wol:+$('wol').value,led:+$('led').value,ledLow:$('ledLow').checked,outputs:outs};
$('msg').className='';$('msg').textContent='Saving…';
fetch('/api/save',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}).then(r=>r.json()).then(j=>{
if(j.error){$('msg').className='err';$('msg').textContent=j.error}else{$('msg').textContent='Saved. The board restarts and connects to "'+body.ssid+'": you can close this page.'}})
.catch(()=>{$('msg').className='err';$('msg').textContent='The board did not answer: check that you are still on its Wi-Fi network.'})};
</script></body></html>)HTML";

WebServer server(80);
DNSServer dns;
const Settings* current = nullptr;
JsonDocument networks;  // SSIDs seen at start (names chosen by the neighbours: the page escapes them)
uint32_t lastVisit = 0;
bool restartPending = false;
uint32_t restartAt = 0;

void sendPage() {
  lastVisit = millis();
  server.send_P(200, "text/html", PAGE);
}

void sendConfig() {
  lastVisit = millis();
  JsonDocument doc;
  doc["fw"] = AWAKE_FIRMWARE;
  doc["mac"] = WiFi.macAddress();
  JsonArray pins = doc["pins"].to<JsonArray>();
  for (int p = 0; p < 40; p++) {
    if (settings::allowedPin(p)) pins.add(p);
  }
  doc["networks"] = networks.as<JsonArrayConst>();
  if (current) {
    settings::toJson(*current, doc["config"].to<JsonObject>());
  } else {
    doc["config"] = nullptr;
  }
  String body;
  serializeJson(doc, body);
  server.send(200, "application/json", body);
}

void sendError(const char* message) {
  JsonDocument doc;
  doc["error"] = message;
  String body;
  serializeJson(doc, body);
  server.send(200, "application/json", body);
}

void save() {
  lastVisit = millis();
  JsonDocument doc;
  if (deserializeJson(doc, server.arg("plain"))) return sendError("The page sent an invalid request: reload it.");
  static Settings next;  // large: not on the stack
  const char* err = settings::fromJson(doc.as<JsonVariantConst>(), next, current);
  if (err) return sendError(err);
  if (!settings::save(next)) return sendError("Could not save the configuration on the board.");
  LOGI("portal", "configuration saved (%u outputs), restarting", next.outputCount);
  server.send(200, "application/json", "{\"ok\":true}");
  restartPending = true;
  restartAt = millis() + 1500;  // let the answer reach the phone first
}

// Captive portal: any other URL (the phones' connectivity checks included) goes to the setup page.
void redirect() {
  server.sendHeader("Location", String("http://") + WiFi.softAPIP().toString() + "/", true);
  server.send(302, "text/plain", "");
}

void scanNetworks() {
  JsonArray list = networks.to<JsonArray>();
  const int n = WiFi.scanNetworks();
  for (int i = 0; i < n && list.size() < 20; i++) {
    const String ssid = WiFi.SSID(i);
    if (ssid.isEmpty()) continue;
    bool seen = false;
    for (JsonVariant v : list) seen = seen || ssid == v.as<const char*>();
    if (!seen) list.add(ssid);
  }
  WiFi.scanDelete();
}

}  // namespace

namespace portal {

void run(const Settings* settingsNow) {
  current = settingsNow;
  WiFi.disconnect(true);
  WiFi.mode(WIFI_AP_STA);
  scanNetworks();

  uint8_t mac[6];
  WiFi.macAddress(mac);
  char ssid[32];
  snprintf(ssid, sizeof ssid, "Awake-Setup-%02X%02X", mac[4], mac[5]);
  WiFi.softAP(ssid, AP_PASSWORD);
  dns.start(53, "*", WiFi.softAPIP());

  server.on("/", HTTP_GET, sendPage);
  server.on("/api/config", HTTP_GET, sendConfig);
  server.on("/api/save", HTTP_POST, save);
  server.onNotFound(redirect);
  server.begin();
  LOGI("portal", "setup mode: join Wi-Fi \"%s\" (password \"%s\") and open http://%s", ssid, AP_PASSWORD,
       WiFi.softAPIP().toString().c_str());

  statusLeds::show(AgentStatus::SETUP);
  lastVisit = millis();
  for (;;) {
    watchdogFeed();
    dns.processNextRequest();
    server.handleClient();
    statusLeds::tick();
    if (restartPending && (int32_t)(millis() - restartAt) >= 0) ESP.restart();
    if (current && millis() - lastVisit > IDLE_RESTART_MS) {
      LOGI("portal", "no visit for 10 minutes, restarting with the saved configuration");
      ESP.restart();
    }
    delay(2);
  }
}

}  // namespace portal
