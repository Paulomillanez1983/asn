/* Arranque: captura de errores, respaldo del logo y vigilante de carga */
window.__asnErr = null;

window.addEventListener('error', function (e) {
  window.__asnErr = (e.message || 'error') + (e.filename ? ' @' + e.filename + ':' + e.lineno : '');
});

(function () {
  var img = document.getElementById('logoImg');
  if (img) {
    img.addEventListener('error', function () { img.remove(); });
  }
})();

setTimeout(function () {
  if (window.__asnBooted) return;
  var v = document.getElementById('view');
  if (!v) return;
  var detalle = window.__asnErr
    ? '<p class="hint" style="margin-top:6px;color:#fca5a5">' + window.__asnErr + '</p>'
    : '<p class="hint" style="margin-top:6px">La conexión viene lenta. Podés esperar o recargar.</p>';
  v.innerHTML = '<div class="card" style="margin-top:18px"><b>Todavía no cargó</b>' + detalle +
    '<button id="reloadBtn" style="margin-top:12px">Recargar</button></div>';
  var b = document.getElementById('reloadBtn');
  if (b) b.addEventListener('click', function () { location.reload(); });
}, 20000);
