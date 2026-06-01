/* ============================================================
   Geoportal · Potencial de Regeneração em TIs — Rondônia
   Leaflet + Turf.js  ·  dados GeoJSON estáticos (GitHub Pages)
   ============================================================ */

/* ---------------------------------------------------------------
   CONFIGURAÇÃO
   --------------------------------------------------------------- */
const CFG = {
  dataDir: 'data',
  // pastas das camadas carregadas por demanda (opção B)
  perTi: {
    floresta:     { folder: 'floresta_secundaria', color: '#ff0051' },
    potencial:    { folder: 'potencial_rn',        color: '#008bfb' },
    recomposicao: { folder: 'recomposicao',        color: '#f3c300' }
  },
  ink: '#243342',
  panel: '#ecf0f1',
  // campos esperados na camada de TIs (vindos do seu GPKG)
  fields: {
    nome:        'terrai_nom',
    superficie:  'superficie',
    floresta:    'floresta_ha',
    potencial:   'potencial_ha',
    recomposicao:'recomposicao_ha'
  }
};

/* ---------------------------------------------------------------
   UTILITÁRIOS
   --------------------------------------------------------------- */

// Reproduz a convenção de slug do script Python que gerou os arquivos:
// minúsculas, sem acento, não-alfanumérico -> "_", sem "_" nas pontas.
function slugify(s) {
  return String(s)
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '') // remove acentos
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

// Formata número em pt-BR (1 casa decimal). Aceita string ou número.
function fmt(v, dec = 1) {
  const n = Number(v);
  if (!isFinite(n)) return '—';
  return n.toLocaleString('pt-BR', {
    minimumFractionDigits: dec, maximumFractionDigits: dec
  });
}
function fmtInt(v) {
  const n = Number(v);
  return isFinite(n) ? n.toLocaleString('pt-BR') : '—';
}

// fetch de GeoJSON; retorna null em 404/erro (camada ausente é normal na opção B)
async function fetchGeoJSON(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    console.warn('Falha ao carregar', url, e);
    return null;
  }
}

/* ---------------------------------------------------------------
   MAPA + CAMADAS BASE
   --------------------------------------------------------------- */
const map = L.map('map', { zoomControl: false, minZoom: 4, maxZoom: 19 })
  .setView([-10.9, -62.8], 7); // centro aproximado de Rondônia

L.control.zoom({ position: 'topright' }).addTo(map);

const baseGoogleSat = L.tileLayer(
  'https://mt{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}',
  { subdomains: '0123', maxZoom: 20, attribution: '© Google' }
);
const baseGoogleHybrid = L.tileLayer(
  'https://mt{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}',
  { subdomains: '0123', maxZoom: 20, attribution: '© Google' }
);
const baseEsri = L.tileLayer(
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  { maxZoom: 19, attribution: 'Tiles © Esri' }
);

baseGoogleSat.addTo(map);
L.control.layers(
  { 'Satélite (Google)': baseGoogleSat,
    'Híbrido (Google)':  baseGoogleHybrid,
    'Esri World Imagery': baseEsri },
  null, { position: 'topright', collapsed: true }
).addTo(map);

/* ---------------------------------------------------------------
   GRUPOS DE CAMADAS
   --------------------------------------------------------------- */
const tiLayer       = L.geoJSON(null, { style: styleTI, onEachFeature: onEachTI });
const overlay = {
  floresta:     L.geoJSON(null, { style: () => stylePoly(CFG.perTi.floresta.color) }),
  potencial:    L.geoJSON(null, { style: () => stylePoly(CFG.perTi.potencial.color) }),
  recomposicao: L.geoJSON(null, { style: () => stylePoly(CFG.perTi.recomposicao.color) }),
  aldeias:      L.layerGroup()
};
tiLayer.addTo(map);
Object.values(overlay).forEach(l => l.addTo(map));

// visibilidade controlada pelos checkboxes
const visible = { floresta: true, potencial: true, recomposicao: true, aldeias: true };

/* ---------------------------------------------------------------
   ESTILOS
   --------------------------------------------------------------- */
function styleTI(feature) {
  return {
    color: CFG.ink, weight: 1.6, opacity: 0.9,
    fillColor: CFG.ink, fillOpacity: 0.04
  };
}
function styleTIHighlight() {
  return { color: CFG.ink, weight: 3, opacity: 1, fillColor: CFG.ink, fillOpacity: 0 };
}
function stylePoly(color) {
  return { color: color, weight: 0.6, opacity: 0.9, fillColor: color, fillOpacity: 0.55 };
}

// marcador "alvo" das aldeias: círculo externo claro + interno escuro
function aldeiaMarker(latlng) {
  const html =
    '<svg width="16" height="16" viewBox="0 0 16 16">' +
      '<circle cx="8" cy="8" r="6.5" fill="' + CFG.panel + '" stroke="' + CFG.ink + '" stroke-width="1.6"/>' +
      '<circle cx="8" cy="8" r="2.8" fill="' + CFG.ink + '"/>' +
    '</svg>';
  return L.marker(latlng, {
    icon: L.divIcon({ className: 'aldeia-marker', html, iconSize: [16,16], iconAnchor: [8,8] })
  });
}

/* ---------------------------------------------------------------
   INTERAÇÃO COM A CAMADA DE TIs
   --------------------------------------------------------------- */
let allAldeias = null;        // FeatureCollection completa (carregada uma vez)
let selectedLayer = null;     // camada Leaflet da TI selecionada

function onEachTI(feature, layer) {
  const nome = feature.properties[CFG.fields.nome] || 'Terra Indígena';
  layer.bindTooltip(nome, { sticky: true, direction: 'top', opacity: 0.95 });
  layer.on('click', () => selectTI(nome));
}

/* ---------------------------------------------------------------
   SELEÇÃO DE TI  →  carrega camadas por demanda + atualiza painel
   --------------------------------------------------------------- */
async function selectTI(nome) {
  const select = document.getElementById('ti-select');
  if (select.value !== nome) select.value = nome;
  document.getElementById('reset-btn').hidden = false;

  // localiza a feature da TI
  let tiFeature = null;
  tiLayer.eachLayer(l => {
    if (l.feature && l.feature.properties[CFG.fields.nome] === nome) {
      tiFeature = l.feature;
      if (selectedLayer) selectedLayer.setStyle(styleTI());
      l.setStyle(styleTIHighlight());
      selectedLayer = l;
      map.fitBounds(l.getBounds(), { padding: [40, 40], maxZoom: 14 });
    }
  });
  if (!tiFeature) return;

  updatePanel(tiFeature);
  showLoader(true);

  // limpa overlays por-TI
  ['floresta', 'potencial', 'recomposicao'].forEach(k => overlay[k].clearLayers());
  overlay.aldeias.clearLayers();

  const slug = slugify(nome);

  // carrega as 3 camadas por TI em paralelo
  const jobs = Object.entries(CFG.perTi).map(async ([key, conf]) => {
    const url = `${CFG.dataDir}/por_ti/${conf.folder}/${slug}.geojson`;
    const gj = await fetchGeoJSON(url);
    if (gj) overlay[key].addData(gj);
  });
  await Promise.all(jobs);

  // aldeias dentro da TI (point-in-polygon via Turf — independe de campo de código)
  const nAldeias = renderAldeiasInside(tiFeature);
  document.getElementById('v-aldeias').textContent = fmtInt(nAldeias);

  applyVisibility();
  showLoader(false);
}

// usa Turf para contar/desenhar só as aldeias dentro do polígono da TI
function renderAldeiasInside(tiFeature) {
  if (!allAldeias) return 0;
  let count = 0;
  allAldeias.features.forEach(pt => {
    try {
      if (turf.booleanPointInPolygon(pt, tiFeature)) {
        const [lng, lat] = pt.geometry.coordinates;
        const m = aldeiaMarker([lat, lng]);
        const nm = pt.properties && (pt.properties.nome_aldei || pt.properties.nome || '');
        if (nm) m.bindPopup('<div class="popup-title">' + nm + '</div><div class="popup-sub">Aldeia</div>');
        overlay.aldeias.addLayer(m);
        count++;
      }
    } catch (e) { /* geometria inválida → ignora */ }
  });
  return count;
}

/* ---------------------------------------------------------------
   PAINEL
   --------------------------------------------------------------- */
function updatePanel(feature) {
  const p = feature.properties;
  document.getElementById('stats-empty').hidden = true;
  document.getElementById('stats').hidden = false;
  document.getElementById('ti-name').textContent = p[CFG.fields.nome] || '—';
  document.getElementById('v-superficie').textContent  = fmt(p[CFG.fields.superficie]);
  document.getElementById('v-floresta').textContent    = fmt(p[CFG.fields.floresta]);
  document.getElementById('v-potencial').textContent   = fmt(p[CFG.fields.potencial]);
  document.getElementById('v-recomposicao').textContent= fmt(p[CFG.fields.recomposicao]);
}

function resetView() {
  document.getElementById('ti-select').value = '';
  document.getElementById('reset-btn').hidden = true;
  document.getElementById('stats').hidden = true;
  document.getElementById('stats-empty').hidden = false;
  if (selectedLayer) { selectedLayer.setStyle(styleTI()); selectedLayer = null; }
  ['floresta','potencial','recomposicao'].forEach(k => overlay[k].clearLayers());
  overlay.aldeias.clearLayers();
  if (tiLayer.getLayers().length) map.fitBounds(tiLayer.getBounds(), { padding: [30, 30] });
}

/* ---------------------------------------------------------------
   VISIBILIDADE (checkboxes)
   --------------------------------------------------------------- */
function applyVisibility() {
  Object.keys(visible).forEach(k => {
    const layer = overlay[k];
    if (visible[k]) { if (!map.hasLayer(layer)) layer.addTo(map); }
    else { if (map.hasLayer(layer)) map.removeLayer(layer); }
  });
}

/* ---------------------------------------------------------------
   UI HELPERS
   --------------------------------------------------------------- */
function showLoader(on) { document.getElementById('loader').hidden = !on; }

/* ---------------------------------------------------------------
   INICIALIZAÇÃO
   --------------------------------------------------------------- */
async function init() {
  // checkboxes de camada
  document.querySelectorAll('#layers input[data-layer]').forEach(cb => {
    cb.addEventListener('change', e => {
      visible[e.target.dataset.layer] = e.target.checked;
      applyVisibility();
    });
  });
  document.getElementById('reset-btn').addEventListener('click', resetView);
  document.getElementById('ti-select').addEventListener('change', e => {
    if (e.target.value) selectTI(e.target.value);
    else resetView();
  });

  // toggle do painel (mobile)
  const panel = document.getElementById('panel');
  const tgl = document.getElementById('panel-toggle');
  tgl.addEventListener('click', () => {
    panel.classList.toggle('hidden');
    tgl.classList.toggle('shifted', !panel.classList.contains('hidden'));
    setTimeout(() => map.invalidateSize(), 360);
  });

  // 1) Terras Indígenas
  const tis = await fetchGeoJSON(`${CFG.dataDir}/terras_indigenas.geojson`);
  if (tis) {
    tiLayer.addData(tis);
    if (tiLayer.getLayers().length) {
      map.fitBounds(tiLayer.getBounds(), { padding: [30, 30] });
    }
    // popula o seletor em ordem alfabética
    const nomes = tis.features
      .map(f => f.properties[CFG.fields.nome])
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b, 'pt-BR'));
    const select = document.getElementById('ti-select');
    select.innerHTML = '<option value="">Todas as TIs (' + nomes.length + ')</option>' +
      nomes.map(n => `<option value="${n}">${n}</option>`).join('');
  } else {
    document.getElementById('ti-select').innerHTML =
      '<option value="">Erro ao carregar TIs</option>';
    console.error('Não encontrei data/terras_indigenas.geojson');
  }

  // 2) Aldeias (carregadas uma vez; filtradas por TI via Turf)
  allAldeias = await fetchGeoJSON(`${CFG.dataDir}/aldeias.geojson`);
  if (!allAldeias) console.warn('data/aldeias.geojson não encontrado.');
}

init();
