// === ПОЛНЫЙ КОД JAVASCRIPT ВИДЖЕТА (Версия: v9.9.16) ===

// === ГЛОБАЛЬНЫЕ ПЕРЕМЕННЫЕ ===
let map;
let meetingPointMarker = null; // Синий - Место встречи (из B,C)
let routeStartMarker = null;   // Зеленый - Старт маршрута (из X,Y)
let endRouteMarker = null;     // Пурпурный - Конец маршрута (из Z,AA)

let currentRecordId = null;
let currentTableId = null;
const HARDCODED_TABLE_ID = "Table1";
const apiKey = 'AIzaSyC-NbhYb2Dh4wRcJnVADh3KU7IINUa6pB8'; // ВАШ API КЛЮЧ!
const MARKER_ZOOM_LEVEL = 15; // Используется для Leaflet, можно использовать и для Google Maps ссылки

let meetingPointJustUpdatedByAction = false; 
let lastProcessedRecordIdForMeetingPoint = null; 

// === ИКОНКИ МАРКЕРОВ ===
const blueIconUrl = 'Parking-32.png';
const greenIconUrl = 'trekking-32.png'; 
const purpleIconUrl = 'Finish-Flag-32.png';

const commonIconOptions = {
    iconSize: [32, 32],
    iconAnchor: [16, 32], 
    popupAnchor: [0, -32],
    tooltipAnchor: [16, -24] 
};

const blueIcon = L.icon({ ...commonIconOptions, iconUrl: blueIconUrl });
const greenIcon = L.icon({ ...commonIconOptions, iconUrl: greenIconUrl });
const purpleIcon = L.icon({ ...commonIconOptions, iconUrl: purpleIconUrl });

// === ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ (translateText, getTravelTime) ===
async function translateText(text, targetLang, apiKey) {
    if (!text || typeof text !== 'string' || !text.trim()) { return ''; }
    const url = `https://translation.googleapis.com/language/translate/v2?key=${apiKey}`;
    console.log(`DEBUG: translateText: "${text}" to ${targetLang}`);
    try {
        const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' }, body: JSON.stringify({ q: text, target: targetLang }) });
        const b = await r.text(); console.log(`DEBUG: translateText status for "${text}": ${r.status}`);
        if (!r.ok) { throw new Error(`Translation API error ${r.status}`); }
        const d = JSON.parse(b);
        if (d?.data?.translations?.[0]?.translatedText) {
            const t = d.data.translations[0].translatedText; console.log(`DEBUG: translateText success: "${text}" -> "${t}"`);
            const e = document.createElement('textarea'); e.innerHTML = t; return e.value;
        } else { console.warn(`DEBUG: translateText no translation for "${text}"`); return text; }
    } catch (e) { console.error(`DEBUG: translateText fail for "${text}":`, e); return text; }
}

async function getTravelTime(originLatLng, destinationLatLng, departureTime) {
    let travelTimeResult = 'N/A';
    console.log(`DEBUG: getTravelTime from ${JSON.stringify(originLatLng)} to ${JSON.stringify(destinationLatLng)} at ${departureTime.toISOString()}`);
    try {
        if (typeof google === 'undefined' || !google?.maps?.DirectionsService) { throw new Error("Google Directions Service not loaded."); }
        const service = new google.maps.DirectionsService();
        const request = { origin: originLatLng, destination: destinationLatLng, travelMode: google.maps.TravelMode.DRIVING, drivingOptions: { departureTime: departureTime, trafficModel: google.maps.TrafficModel.BEST_GUESS } };
        const result = await new Promise((resolve, reject) => service.route(request, (res, stat) => stat === google.maps.DirectionsStatus.OK ? resolve(res) : reject(new Error(`Directions status: ${stat}.`))));
        if (result.routes?.[0]?.legs?.[0]) {
            const leg = result.routes[0].legs[0];
            travelTimeResult = leg.duration_in_traffic?.text || leg.duration?.text || 'Время не найдено';
            if (result.routes[0].warnings?.some(w => typeof w === 'string' && ['border', 'границ', 'checkpoint', 'crossing', 'territories', 'territory', 'таможн'].some(k => w.toLowerCase().includes(k.toLowerCase())))) {
                travelTimeResult += " (ПРЕДУПРЕЖДЕНИЕ О ГРАНИЦЕ!)";
            }
        } else { travelTimeResult = `Google: ${result.status || 'Маршрут не найден'}`; }
    } catch (e) { travelTimeResult = `Google: Ошибка (${e.message || 'Неизвестно'})`; }
    console.log(`DEBUG: getTravelTime result: ${travelTimeResult}`);
    return travelTimeResult;
}

// === ОСНОВНЫЕ ФУНКЦИИ ===
function initMap() {
    console.log("DEBUG: initMap()");
    try {
        map = L.map('map').setView([31.771959, 35.217018], 8);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: 'OSM' }).addTo(map);
        map.on('click', handleMapClick);
        setupGrist();
    } catch (e) { console.error("ОШИБКА initMap:", e); }
}

function setupGrist() {
    if (typeof grist === 'undefined' || !grist.ready) { console.error("ОШИБКА: Grist API не готов."); return; }
    console.log("DEBUG: setupGrist()");
    grist.ready({
        requiredAccess: 'full',
        columns: [
            { name: "X", type: 'Numeric', optional: true, title: 'Старт маршрута Широта' },
            { name: "Y", type: 'Numeric', optional: true, title: 'Старт маршрута Долгота' },
            { name: "HikeStartLabel", type: 'Text', optional: true, title: 'Название Старта маршрута' },
            
            { name: "A", type: 'Text', optional: true, title: 'Название Места встречи' },
            { name: "B", type: 'Numeric', title: 'Место встречи Широта' },
            { name: "C", type: 'Numeric', title: 'Место встречи Долгота' },
            { name: "GoogleDrive", type: 'Text', optional: true, title: 'Место встреч. GoogleDrive' }, 
            
            { name: "D", type: 'Text', optional: true, title: 'Адрес Места встречи: Город' },
            { name: "E", type: 'Text', optional: true, title: 'Адрес Места встречи: Район' },
            { name: "F", type: 'Text', optional: true, title: 'Адрес Места встречи: Округ' },
            { name: "H_Meeting", type: 'Text', optional: true, title: 'Адрес Места встречи: Микрорайон' },
            { name: "I", type: 'Text', optional: true, title: 'К Месту встречи: Время из Т-А' },
            { name: "J", type: 'Text', optional: true, title: 'К Месту встречи: Время из Иерус.' },
            { name: "K", type: 'Text', optional: true, title: 'К Месту встречи: Время из Хайфы' },
            { name: "L", type: 'Text', optional: true, title: 'К Месту встречи: Время из Б-Ш' },
            
            { name: "Z", type: 'Numeric', optional: true, title: 'Конец маршрута Широта' },
            { name: "AA", type: 'Numeric', optional: true, title: 'Конец маршрута Долгота' },
            { name: "EndRouteLabel", type: 'Text', optional: true, title: 'Название Конца маршрута' },
        ]
    });
    grist.onOptions(handleOptionsUpdate);
    grist.onRecord(handleGristRecordUpdate);
    console.log("DEBUG: Grist API готов.");
}

function handleOptionsUpdate(options, interaction) {
    console.log("DEBUG: Grist options:", options, "Interaction:", interaction);
    currentTableId = (options?.tableId) || (interaction?.tableId) || null;
    if (currentTableId) {
        console.log(`DEBUG: Table ID установлен через onOptions: ${currentTableId}`);
    } else {
        console.warn("ПРЕДУПРЕЖДЕНИЕ: Table ID не был предоставлен через grist.onOptions. Будет использован fallback (включая hardcoded).");
    }
}

async function getEnsuredTableId() {
    if (currentTableId) {
        return currentTableId;
    }
    console.log("DEBUG: getEnsuredTableId - currentTableId is null, пытаемся получить через grist.selectedTable.getTableId()");
    if (grist.selectedTable && typeof grist.selectedTable.getTableId === 'function') {
        try {
            const id = await grist.selectedTable.getTableId();
            if (id) {
                currentTableId = id;
                console.log(`DEBUG: getEnsuredTableId - Table ID получен и кэширован через selectedTable: ${currentTableId}`);
                return currentTableId;
            } else {
                console.warn("ПРЕДУПРЕЖДЕНИЕ: getEnsuredTableId - grist.selectedTable.getTableId() вернул falsy:", id);
            }
        } catch (e) {
            console.error("ОШИБКА: getEnsuredTableId - ошибка при вызове grist.selectedTable.getTableId():", e);
        }
    } else {
        console.warn("ПРЕДУПРЕЖДЕНИЕ: getEnsuredTableId - grist.selectedTable или getTableId недоступны.");
    }

    if (!currentTableId && HARDCODED_TABLE_ID) {
        currentTableId = HARDCODED_TABLE_ID;
        console.warn(`ПРЕДУПРЕЖДЕНИЕ: getEnsuredTableId - Table ID не удалось получить автоматически. Используется ЗАХАРДКОЖЕННЫЙ Table ID: "${currentTableId}"`);
        return currentTableId;
    }
    console.error("ОШИБКА КРИТИЧЕСКАЯ: getEnsuredTableId - не удалось определить Table ID никаким способом.");
    return null;
}

function updateOrCreateMarker(markerInstance, latLngLiteral, label, icon, isDraggable, dragEndCallback) {
    const latLng = L.latLng(latLngLiteral.lat, latLngLiteral.lng);
    if (!markerInstance) {
        markerInstance = L.marker(latLng, { icon: icon, draggable: isDraggable, title: label }).addTo(map);
        markerInstance.bindTooltip(label).openTooltip();
    } else {
        markerInstance.setLatLng(latLng);
        if (markerInstance.getElement()) markerInstance.getElement().title = label;
        markerInstance.getTooltip() ? markerInstance.setTooltipContent(label) : markerInstance.bindTooltip(label);
        if (!markerInstance.isTooltipOpen()) markerInstance.openTooltip();
        if (!map.hasLayer(markerInstance)) markerInstance.addTo(map);
        if (markerInstance.options.icon !== icon) markerInstance.setIcon(icon);
    }
    if (markerInstance._onDragEndListener) markerInstance.off('dragend', markerInstance._onDragEndListener);
    if (isDraggable && dragEndCallback) {
        markerInstance.on('dragend', dragEndCallback);
        markerInstance._onDragEndListener = dragEndCallback;
    }
    console.log(`DEBUG: Маркер "${label}" ${markerInstance._leaflet_id ? 'обновлен' : 'создан'}. Иконка:`, icon.options.iconUrl);
    return markerInstance;
}

async function processMeetingPointData(lat, lng, tableId) {
    if (!currentRecordId || !tableId) {
        console.warn(`ПРЕДУПРЕЖДЕНИЕ: Нет Record ID (${currentRecordId}) или Table ID (${tableId}) для processMeetingPointData.`);
        if (!tableId) alert("Ошибка: Таблица для обновления данных Места Встречи не определена (processMeetingPointData).");
        return;
    }
    
    console.log(`DEBUG: processMeetingPointData для Места Встречи: ${lat}, ${lng} (Table: ${tableId})`);
    
    let city_ru = '', county_ru = '', state_ru = '', suburb_ru = '';
    let ttTA = 'N/A', ttJer = 'N/A', ttHai = 'N/A', ttBS = 'N/A';
    
    // ИЗМЕНЕНИЕ: URL для открытия Google Maps с указанием точки назначения (Места Встречи) через параметр q
    const googleMapsSearchUrl = `https://developers.google.com/maps/documentation/javascript/libraries${lat},${lng}`; 
    console.log(`DEBUG: Сгенерирована ссылка Google Maps (поиск точки): ${googleMapsSearchUrl}`);

    const nomUrl = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1&accept-language=en`;
    try {
        const rNom = await fetch(nomUrl); if (!rNom.ok) throw new Error(`Nominatim error ${rNom.status}`);
        const dNom = await rNom.json();
        if (dNom?.address) {
            const a = dNom.address;
            [city_ru, county_ru, state_ru, suburb_ru] = await Promise.all([
                translateText(a.city || a.town || a.village || a.hamlet || '', 'ru', apiKey),
                translateText(a.county || a.state_district || '', 'ru', apiKey),
                translateText(a.state || '', 'ru', apiKey),
                translateText(a.suburb || a.neighbourhood || a.borough || a.quarter || '', 'ru', apiKey)
            ]);
        } else { console.warn("Nominatim не вернул адрес для Места Встречи."); city_ru = "Адрес не найден"; }
    } catch (e) { console.error("ОШИБКА Nominatim/Translate (Место Встречи):", e); city_ru = "Ошибка геокода"; }

    const depDate = new Date(); let dToAdd = (5 - depDate.getDay() + 7) % 7;
    if (dToAdd === 0 && depDate.getHours() >= 7) dToAdd = 7;
    depDate.setDate(depDate.getDate() + dToAdd); depDate.setHours(7,0,0,0);

    const origs = [ {lat:32.0853,lng:34.7818},{lat:31.7683,lng:35.2137},{lat:32.794,lng:34.9896},{lat:31.253,lng:34.7915} ];
    try {
        const tts = await Promise.all(origs.map(o => getTravelTime(o, {lat,lng}, depDate)));
        [ttTA, ttJer, ttHai, ttBS] = tts.map(t => t || 'N/A');
    } catch (e) { console.error("ОШИБКА Google Directions (Место Встречи):", e); }

    const updData = { 
        D: city_ru, E: county_ru, F: state_ru, H_Meeting: suburb_ru, 
        I: ttTA, J: ttJer, K: ttHai, L: ttBS,
        "GoogleDrive": googleMapsSearchUrl 
    };
    Object.keys(updData).forEach(k => (updData[k] === undefined || updData[k] === null || updData[k] === '') && delete updData[k]);
    try {
        await grist.docApi.applyUserActions([['UpdateRecord', tableId, currentRecordId, updData]]);
        console.log("DEBUG: Данные адреса/времени/ссылки для Места встречи обновлены в Grist.");
    } catch (e) { console.error("ОШИБКА обновления Grist (Meeting Point Data):", e); }
}

async function handleGristRecordUpdate(record, mappings) {
    console.log("DEBUG: Grist record update:", record);
    const previousRecordId = currentRecordId;
    currentRecordId = record?.id || null;
    console.log("DEBUG: Current Record ID:", currentRecordId);

    if (previousRecordId !== currentRecordId) {
        console.log("DEBUG: ID записи изменился, сбрасываем meetingPointJustUpdatedByAction и lastProcessedRecordIdForMeetingPoint.");
        meetingPointJustUpdatedByAction = false; 
        lastProcessedRecordIdForMeetingPoint = null; 
    }
    
    if (!map) { console.warn("ПРЕДУПРЕЖДЕНИЕ: Карта не инициализирована."); return; }

    if (meetingPointMarker) { meetingPointMarker.remove(); meetingPointMarker = null; }
    if (routeStartMarker) { routeStartMarker.remove(); routeStartMarker = null; }
    if (endRouteMarker) { endRouteMarker.remove(); endRouteMarker = null; }

    if (!record) {
        console.log("DEBUG: Запись Grist не выбрана.");
        meetingPointJustUpdatedByAction = false;
        lastProcessedRecordIdForMeetingPoint = null;
        return;
    }

    const tableId = await getEnsuredTableId(); 

    // Маркер "Старт маршрута" (зеленый, из X,Y)
    if (typeof record.X === 'number' && typeof record.Y === 'number') {
        const label = record.HikeStartLabel || `Старт маршрута (ID: ${record.id || 'N/A'})`;
        routeStartMarker = updateOrCreateMarker(routeStartMarker, { lat: record.X, lng: record.Y }, label, greenIcon, true, onRouteStartMarkerDragEnd);
    } else {
        console.log("DEBUG: Координаты для 'Старта маршрута' (X,Y) отсутствуют.");
    }

    // Маркер "Место встречи" (синий, из B,C)
    if (typeof record.B === 'number' && typeof record.C === 'number') {
        const label = record.A || `Место встречи (ID: ${record.id || 'N/A'})`;
        meetingPointMarker = updateOrCreateMarker(meetingPointMarker, { lat: record.B, lng: record.C }, label, blueIcon, true, onMeetingPointMarkerDragEnd);
        
        const meetingDataIsMissingOrEmpty = !record.D || record.D.trim() === '' || record.D === "Адрес не найден" || record.D === "Ошибка геокода" || 
                                           !record.I || record.I.trim() === '' || record.I === 'N/A' || record.I.includes("Ошибка") ||
                                           !record["GoogleDrive"]; 

        if (tableId && (meetingPointJustUpdatedByAction || (lastProcessedRecordIdForMeetingPoint !== currentRecordId && meetingDataIsMissingOrEmpty) )) {
            console.log(`DEBUG: Обработка данных для Места Встречи. Флаг justUpdated: ${meetingPointJustUpdatedByAction}, DataMissingOrEmpty: ${meetingDataIsMissingOrEmpty}, lastProcessedRecId: ${lastProcessedRecordIdForMeetingPoint}, currentRecId: ${currentRecordId}`);
            await processMeetingPointData(record.B, record.C, tableId);
            lastProcessedRecordIdForMeetingPoint = currentRecordId; 
        } else if (!tableId) {
            console.warn("ПРЕДУПРЕЖДЕНИЕ: Table ID не установлен, processMeetingPointData не будет вызван для Места Встречи.");
        } else {
            console.log("DEBUG: Данные для Места Встречи уже существуют или не требуют немедленной переобработки. Пропуск processMeetingPointData.");
        }
    } else {
        console.log("DEBUG: Координаты для 'Места встречи' (B,C) отсутствуют.");
        if (lastProcessedRecordIdForMeetingPoint === currentRecordId) { 
             lastProcessedRecordIdForMeetingPoint = null;
        }
    }
    meetingPointJustUpdatedByAction = false; 

    // Маркер "Конец маршрута" (пурпурный, из Z,AA)
    if (typeof record.Z === 'number' && typeof record.AA === 'number') {
        const label = record.EndRouteLabel || `Конец маршрута (ID: ${record.id || 'N/A'})`;
        endRouteMarker = updateOrCreateMarker(endRouteMarker, { lat: record.Z, lng: record.AA }, label, purpleIcon, true, onEndRouteMarkerDragEnd);
    } else {
        console.log("DEBUG: Координаты для 'Конца маршрута' (Z,AA) отсутствуют.");
    }
    
    const activeMarkers = [meetingPointMarker, routeStartMarker, endRouteMarker].filter(m => m !== null);
    if (activeMarkers.length > 1) map.fitBounds(new L.featureGroup(activeMarkers).getBounds().pad(0.2));
    else if (activeMarkers.length === 1) map.flyTo(activeMarkers[0].getLatLng(), MARKER_ZOOM_LEVEL);
}

async function updateGristCoordinates(markerType, lat, lng) { 
    const tableId = await getEnsuredTableId(); 

    if (!currentRecordId || !tableId) {
        console.warn(`ПРЕДУПРЕЖДЕНИЕ: Нет Record ID (${currentRecordId}) или Table ID (${tableId}) для updateGristCoordinates (${markerType})`);
        if (!tableId) {
             alert("Ошибка: Таблица для обновления не определена (updateGristCoordinates).");
        }
        return false;
    }

    let updateData = {};
    if (markerType === 'routeStart') { 
        updateData = { X: lat, Y: lng };
    } else if (markerType === 'meetingPoint') { 
        updateData = { B: lat, C: lng };
    } else if (markerType === 'endRoute') { 
        updateData = { Z: lat, AA: lng };
    } else {
        console.error("ОШИБКА: Неизвестный тип маркера для обновления координат:", markerType); return false;
    }
    try {
        await grist.docApi.applyUserActions([['UpdateRecord', tableId, currentRecordId, updateData]]);
        console.log(`DEBUG: Координаты Grist для "${markerType}" обновлены:`, updateData);
        return true; 
    } catch (e) { console.error(`ОШИБКА обновления Grist (${markerType} coords):`, e); return false;}
}

async function onMeetingPointMarkerDragEnd(event) {
    const pos = event.target.getLatLng();
    console.log(`DEBUG: "Место встречи" (синий) перетащено: ${pos.lat}, ${pos.lng}`);
    meetingPointJustUpdatedByAction = true; 
    await updateGristCoordinates('meetingPoint', pos.lat, pos.lng); 
}

async function onRouteStartMarkerDragEnd(event) {
    const pos = event.target.getLatLng();
    console.log(`DEBUG: "Старт маршрута" (зеленый) перетащен: ${pos.lat}, ${pos.lng}`);
    await updateGristCoordinates('routeStart', pos.lat, pos.lng); 
}

async function onEndRouteMarkerDragEnd(event) {
    const pos = event.target.getLatLng();
    console.log(`DEBUG: "Конец маршрута" (пурпурный) перетащен: ${pos.lat}, ${pos.lng}`);
    await updateGristCoordinates('endRoute', pos.lat, pos.lng);
}

async function handleMapClick(e) {
    if (!e.latlng) { console.warn("ПРЕДУПРЕЖДЕНИЕ: Клик без координат."); return; }
    
    if (!currentRecordId && grist.selectedRecord && typeof grist.selectedRecord.get === 'function') {
        try {
            const rec = await grist.selectedRecord.get();
            if (rec && rec.id) {
                currentRecordId = rec.id;
                console.log(`DEBUG: handleMapClick - currentRecordId получен через selectedRecord.get(): ${currentRecordId}`);
            }
        } catch (err) { console.warn("Не удалось получить selectedRecord.id при клике", err); }
    }

    if (!currentRecordId) { alert("Сначала выберите строку в Grist."); return; }

    const tableId = await getEnsuredTableId(); 
    if (!tableId) {
        alert("Ошибка: Таблица для обновления не определена. Проверьте конфигурацию виджета или выберите запись снова.");
        console.error("ОШИБКА: handleMapClick - Table ID не определен. Обновление невозможно.");
        return;
    }

    const lat = e.latlng.lat;
    const lng = e.latlng.lng;
    const clickPosition = { lat: lat, lng: lng };
    
    if (!meetingPointMarker) {
        const label = `Место встречи (ID: ${currentRecordId})`;
        console.log(`DEBUG: Клик для установки "Место встречи" (синий): ${lat}, ${lng}.`);
        meetingPointMarker = updateOrCreateMarker(meetingPointMarker, clickPosition, label, blueIcon, true, onMeetingPointMarkerDragEnd);
        meetingPointJustUpdatedByAction = true; 
        await updateGristCoordinates('meetingPoint', lat, lng);
    } else if (!routeStartMarker) {
        const label = `Старт маршрута (ID: ${currentRecordId})`;
        console.log(`DEBUG: Клик для установки "Старт маршрута" (зеленый): ${lat}, ${lng}.`);
        routeStartMarker = updateOrCreateMarker(routeStartMarker, clickPosition, label, greenIcon, true, onRouteStartMarkerDragEnd);
        await updateGristCoordinates('routeStart', lat, lng);
    } else if (!endRouteMarker) {
        const label = `Конец маршрута (ID: ${currentRecordId})`;
        console.log(`DEBUG: Клик для установки "Конец маршрута" (пурпурный): ${lat}, ${lng}.`);
        endRouteMarker = updateOrCreateMarker(endRouteMarker, clickPosition, label, purpleIcon, true, onEndRouteMarkerDragEnd);
        await updateGristCoordinates('endRoute', lat, lng);
    } else {
        console.log("DEBUG: Все три маркера уже установлены. Клик проигнорирован.");
        alert("Все три основных маркера уже установлены. Для изменения их положения, перетащите их.");
    }
}

function checkApis() {
    const leafletReady = typeof L === 'object' && L.map;
    const googleReady = typeof google === 'object' && google.maps && google.maps.DirectionsService;
    console.log(`DEBUG: API check: Leaflet=${leafletReady}, Google Maps (Directions)=${googleReady}`);
    if (leafletReady && googleReady) initMap();
    else setTimeout(checkApis, 250);
}

console.log("DEBUG: grist_map_widget_hiking.js (v9.9.15): Запуск checkApis.");
checkApis();
// === КОНЕЦ СКРИПТА ===
