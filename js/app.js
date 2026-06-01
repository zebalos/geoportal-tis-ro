/* ============================================================
   Geoportal · Potencial de Regeneração em TIs — Rondônia
   Leaflet + Turf.js  ·  dados GeoJSON estáticos (GitHub Pages)
   ============================================================ */

/* ---------------------------------------------------------------
   CONFIGURAÇÃO
   --------------------------------------------------------------- */
const CFG = {
  dataDir: 'data',
  perTi: {
    floresta:     { folder: 'floresta_secundaria', color: '#ff0051' },
    potencial:    { folder: 'potencial_rn',        color: '#008bfb' },
    recomposicao: { folder: 'recomposicao',        color: '#f3c300' }
  },
  ink:   '#243342',
  panel: '#ecf0f1',
  fields: {
    nome:         'terrai_nom',
    superficie:   'superficie',
    floresta:     'floresta_ha',
    potencial:    'potencial_ha',
    recomposicao: 'recomposicao_ha'
  }
};

/* ---------------------------------------------------------------
   UTILITÁRIOS
   --------------------------------------------------------------- */
function slugify(s) {
  return String(s)
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

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
  .setView([-10.9, -62.8], 7);

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
   IMPORTANTE: L.featureGroup() em vez de layerGroup() para que
   todas as overlays suportem bringToFront/bringToBack.
   --------------------------------------------------------------- */
const tiLayer = L.geoJSON(null, { style: styleTI, onEachFeature: onEachTI });
const overlay = {
  potencial:    L.geoJSON(null, { style: () => stylePoly(CFG.perTi.potencial.color) }),
  floresta:     L.geoJSON(null, { style: () => stylePoly(CFG.perTi.floresta.color) }),
  recomposicao: L.geoJSON(null, { style: () => stylePoly(CFG.perTi.recomposicao.color) }),
  aldeias:      L.featureGroup()
};

tiLayer.addTo(map);
overlay.potencial.addTo(map);
overlay.floresta.addTo(map);
overlay.recomposicao.addTo(map);
overlay.aldeias.addTo(map);

const visible = { floresta: true, potencial: true, recomposicao: true, aldeias: true };

/* ---------------------------------------------------------------
   ESTILOS
   --------------------------------------------------------------- */
function styleTI() {
  return {
    color: CFG.panel, weight: 1.6, opacity: 0.9,
    fillColor: CFG.ink, fillOpacity: 0.04
  };
}
function styleTIHighlight() {
  return {
    color: CFG.panel, weight: 3, opacity: 1,
    fillColor: CFG.ink, fillOpacity: 0
  };
}
function stylePoly(color) {
  return { color, weight: 0.6, opacity: 0.9, fillColor: color, fillOpacity: 0.55 };
}

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
   HIERARQUIA DE RENDERIZAÇÃO
   Ordem (de baixo para cima):
     tiLayer  →  potencial  →  floresta  →  recomposição  →  aldeias
   --------------------------------------------------------------- */
function enforceLayerOrder() {
  try {
    // Só reordena camadas que estão atualmente no mapa
    if (map.hasLayer(tiLayer))              tiLayer.bringToBack();
    if (map.hasLayer(overlay.potencial))    overlay.potencial.bringToFront();
    if (map.hasLayer(overlay.floresta))     overlay.floresta.bringToFront();
    if (map.hasLayer(overlay.recomposicao)) overlay.recomposicao.bringToFront();
    if (map.hasLayer(overlay.aldeias))      overlay.aldeias.bringToFront();
  } catch (e) {
    console.warn('enforceLayerOrder:', e);
  }
}

/* ---------------------------------------------------------------
   ESTADO GLOBAL
   --------------------------------------------------------------- */
let allAldeias    = null;
let selectedLayer = null;

/* ---------------------------------------------------------------
   INTERAÇÃO COM A CAMADA DE TIs
   --------------------------------------------------------------- */
function onEachTI(feature, layer) {
  const nome = feature.properties[CFG.fields.nome] || 'Terra Indígena';
  layer.bindTooltip(nome, { sticky: true, direction: 'top', opacity: 0.95 });
  layer.on('click', () => {
    document.getElementById('ti-select').value = nome;
    selectTI(nome);
  });
}

/* ---------------------------------------------------------------
   VISÃO GERAL — carrega TODAS as camadas + stats agregadas
   --------------------------------------------------------------- */
async function loadAllLayers() {
  document.getElementById('reset-btn').hidden = true;

  if (selectedLayer) { selectedLayer.setStyle(styleTI()); selectedLayer = null; }
  clearOverlays();
  updatePanelAll();

  if (tiLayer.getLayers().length)
    map.fitBounds(tiLayer.getBounds(), { padding: [30, 30] });

  const nomes = [];
  tiLayer.eachLayer(l => {
    if (l.feature) nomes.push(l.feature.properties[CFG.fields.nome]);
  });

  const total = nomes.length * Object.keys(CFG.perTi).length;
  let carregados = 0;

  setLoaderText(`Carregando camadas… (0 / ${total})`);
  showLoader(true);

  try {
    const jobs = [];
    for (const nome of nomes) {
      const slug = slugify(nome);
      for (const [key, conf] of Object.entries(CFG.perTi)) {
        jobs.push(
          fetchGeoJSON(`${CFG.dataDir}/por_ti/${conf.folder}/${slug}.geojson`)
            .then(gj => {
              try { if (gj) overlay[key].addData(gj); }
              catch (e) { console.warn('addData falhou', key, slug, e); }
              carregados++;
              setLoaderText(`Carregando camadas… (${carregados} / ${total})`);
            })
        );
      }
    }

    // Renderiza todas as aldeias
    if (allAldeias) {
      allAldeias.features.forEach(pt => {
        try {
          const [lng, lat] = pt.geometry.coordinates;
          const m = aldeiaMarker([lat, lng]);
          const nm = pt.properties &&
            (pt.properties.nome_aldei || pt.properties.nome || '');
          if (nm) m.bindPopup(
            '<div class="popup-title">' + nm + '</div>' +
            '<div class="popup-sub">Aldeia</div>'
          );
          overlay.aldeias.addLayer(m);
        } catch (e) { /* geometria inválida */ }
      });
      document.getElementById('v-aldeias').textContent =
        fmtInt(allAldeias.features.length);
    }

    await Promise.all(jobs);

    enforceLayerOrder();
    applyVisibility();
  } catch (e) {
    console.error('Erro em loadAllLayers:', e);
  } finally {
    showLoader(false);
  }
}

/* ---------------------------------------------------------------
   STATS AGREGADAS (Todas as TIs)
   --------------------------------------------------------------- */
function updatePanelAll() {
  let superficie = 0, floresta = 0, potencial = 0, recomposicao = 0, nTIs = 0;
  tiLayer.eachLayer(l => {
    if (!l.feature) return;
    const p = l.feature.properties;
    superficie   += Number(p[CFG.fields.superficie])   || 0;
    floresta     += Number(p[CFG.fields.floresta])     || 0;
    potencial    += Number(p[CFG.fields.potencial])    || 0;
    recomposicao += Number(p[CFG.fields.recomposicao]) || 0;
    nTIs++;
  });

  document.getElementById('stats-empty').hidden = true;
  document.getElementById('stats').hidden       = false;
  document.getElementById('ti-name').textContent          = `Todas as TIs (${nTIs})`;
  document.getElementById('v-superficie').textContent     = fmt(superficie);
  document.getElementById('v-floresta').textContent       = fmt(floresta);
  document.getElementById('v-potencial').textContent      = fmt(potencial);
  document.getElementById('v-recomposicao').textContent   = fmt(recomposicao);
  document.getElementById('v-aldeias').textContent        =
    allAldeias ? fmtInt(allAldeias.features.length) : '—';
}

/* ---------------------------------------------------------------
   SELEÇÃO DE TI INDIVIDUAL
   --------------------------------------------------------------- */
async function selectTI(nome) {
  document.getElementById('reset-btn').hidden = false;

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
  clearOverlays();

  setLoaderText('Carregando camadas…');
  showLoader(true);

  try {
    const slug = slugify(nome);
    const jobs = Object.entries(CFG.perTi).map(async ([key, conf]) => {
      const gj = await fetchGeoJSON(
        `${CFG.dataDir}/por_ti/${conf.folder}/${slug}.geojson`
      );
      if (gj) {
        try { overlay[key].addData(gj); }
        catch (e) { console.warn('addData falhou', key, slug, e); }
      }
    });

    await Promise.all(jobs);

    const nAldeias = renderAldeiasInside(tiFeature);
    document.getElementById('v-aldeias').textContent = fmtInt(nAldeias);

    enforceLayerOrder();
    applyVisibility();
  } catch (e) {
    console.error('Erro em selectTI:', e);
  } finally {
    showLoader(false);
  }
}

/* ---------------------------------------------------------------
   ALDEIAS — point-in-polygon via Turf (independe de campo código)
   --------------------------------------------------------------- */
function renderAldeiasInside(tiFeature) {
  if (!allAldeias) return 0;
  let count = 0;
  allAldeias.features.forEach(pt => {
    try {
      if (turf.booleanPointInPolygon(pt, tiFeature)) {
        const [lng, lat] = pt.geometry.coordinates;
        const m = aldeiaMarker([lat, lng]);
        const nm = pt.properties &&
          (pt.properties.nome_aldei || pt.properties.nome || '');
        if (nm) m.bindPopup(
          '<div class="popup-title">' + nm + '</div>' +
          '<div class="popup-sub">Aldeia</div>'
        );
        overlay.aldeias.addLayer(m);
        count++;
      }
    } catch (e) { /* geometria inválida */ }
  });
  return count;
}

/* ---------------------------------------------------------------
   PAINEL — TI individual
   --------------------------------------------------------------- */
function updatePanel(feature) {
  const p = feature.properties;
  document.getElementById('stats-empty').hidden   = true;
  document.getElementById('stats').hidden         = false;
  document.getElementById('ti-name').textContent        = p[CFG.fields.nome]         || '—';
  document.getElementById('v-superficie').textContent   = fmt(p[CFG.fields.superficie]);
  document.getElementById('v-floresta').textContent     = fmt(p[CFG.fields.floresta]);
  document.getElementById('v-potencial').textContent    = fmt(p[CFG.fields.potencial]);
  document.getElementById('v-recomposicao').textContent = fmt(p[CFG.fields.recomposicao]);
}

/* ---------------------------------------------------------------
   RESET — volta para visão geral
   --------------------------------------------------------------- */
function resetView() {
  document.getElementById('ti-select').value = '';
  loadAllLayers();
}

/* ---------------------------------------------------------------
   HELPERS
   --------------------------------------------------------------- */
function clearOverlays() {
  ['floresta','potencial','recomposicao'].forEach(k => overlay[k].clearLayers());
  overlay.aldeias.clearLayers();
}

function applyVisibility() {
  Object.keys(visible).forEach(k => {
    const layer = overlay[k];
    if (visible[k]) { if (!map.hasLayer(layer)) layer.addTo(map); }
    else            { if ( map.hasLayer(layer)) map.removeLayer(layer); }
  });
  // Garante hierarquia mesmo após reativar camadas individualmente
  enforceLayerOrder();
}

function showLoader(on) {
  document.getElementById('loader').hidden = !on;
}

function setLoaderText(txt) {
  const el = document.querySelector('.loader-txt');
  if (el) el.textContent = txt;
}

/* ---------------------------------------------------------------
   INICIALIZAÇÃO
   --------------------------------------------------------------- */
async function init() {
  // Checkboxes de camada
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

  // Toggle painel (mobile)
  const panel = document.getElementById('panel');
  const tgl   = document.getElementById('panel-toggle');
  tgl.addEventListener('click', () => {
    panel.classList.toggle('hidden');
    tgl.classList.toggle('shifted', !panel.classList.contains('hidden'));
    setTimeout(() => map.invalidateSize(), 360);
  });

  // 1) Terras Indígenas
  const tis = await fetchGeoJSON(`${CFG.dataDir}/terras_indigenas.geojson`);
  if (tis) {
    tiLayer.addData(tis);
    if (tiLayer.getLayers().length)
      map.fitBounds(tiLayer.getBounds(), { padding: [30, 30] });

    const nomes = tis.features
      .map(f => f.properties[CFG.fields.nome])
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b, 'pt-BR'));

    const select = document.getElementById('ti-select');
    select.innerHTML =
      `<option value="">Todas as TIs (${nomes.length})</option>` +
      nomes.map(n => `<option value="${n}">${n}</option>`).join('');
  } else {
    document.getElementById('ti-select').innerHTML =
      '<option value="">Erro ao carregar TIs</option>';
    console.error('data/terras_indigenas.geojson não encontrado');
    return;
  }

  // 2) Aldeias
  allAldeias = await fetchGeoJSON(`${CFG.dataDir}/aldeias.geojson`);
  if (!allAldeias) console.warn('data/aldeias.geojson não encontrado.');

  // 3) Carrega visão geral como estado inicial
  await loadAllLayers();
}

init();
