// === ПОЛНЫЙ КОД JAVASCRIPT ВИДЖЕТА (Версия: Старт похода, Место встречи, Старт маршрута) ===

// === ГЛОБАЛЬНЫЕ ПЕРЕМЕННЫЕ ===
let map; // Объект Leaflet Map
let hikeStartMarker = null;  // Маркер "Старт похода" (красный, из X,Y)
let meetingPointMarker = null; // Маркер "Место встречи" (синий, из B,C)
let routeStartMarker = null; // Маркер "Старт маршрута" (зеленый, кликом по карте)

let currentRecordId = null; // ID выбранной строки Grist
let currentTableId = null;  // ID таблицы Grist
const apiKey = 'AIzaSyC-NbhYb2Dh4wRcJnVADh3KU7IINUa6pB8'; // ВАШ API КЛЮЧ!
const MARKER_ZOOM_LEVEL = 15;

// === ИКОНКИ МАРКЕРОВ ===
const redIconSVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#FF0000" width="28px" height="28px"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/><path d="M0 0h24v24H0z" fill="none"/></svg>`;
const blueIconSVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#0000FF" width="28px" height="28px"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/><path d="M0 0h24v24H0z" fill="none"/></svg>`;
const greenIconSVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#008000" width="28px" height="28px"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/><path d="M0 0h24v24H0z" fill="none"/></svg>`;

const commonIconOptions = {
    iconSize: [28, 28],
    iconAnchor: [14, 28],
    popupAnchor: [0, -28],
    tooltipAnchor: [14, -18]
};

const redIcon = L.icon({ ...commonIconOptions, iconUrl: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(redIconSVG)}` });
const blueIcon = L.icon({ ...commonIconOptions, iconUrl: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(blueIconSVG)}` });
const greenIcon = L.icon({ ...commonIconOptions, iconUrl: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(greenIconSVG)}` });


// === ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ (translateText, getTravelTime - без изменений) ===
async function translateText(text, targetLang, apiKey) {
    if (!text || typeof text !== 'string' || !text.trim()) { return ''; }
    const url = `https://translation.googleapis.com/language/translate/v2?key=${apiKey}`;
    console.log(`DEBUG: Запрос перевода для: "${text}" на язык ${targetLang}`);
    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
            body: JSON.stringify({ q: text, target: targetLang })
        });
        const responseBody = await response.text();
        console.log(`DEBUG: Статус ответа Translation API для "${text}": ${response.status}`);
        if (!response.ok) { throw new Error(`Translation API error ${response.status}`); }
        const data = JSON.parse(responseBody);
        if (data?.data?.translations?.[0]?.translatedText) {
            const translated = data.data.translations[0].translatedText;
            console.log(`DEBUG: Перевод успешен: "${text}" -> "${translated}"`);
            const tempElem = document.createElement('textarea'); tempElem.innerHTML = translated; return tempElem.value;
        } else { return text; }
    } catch (error) { console.error(`DEBUG: Сбой перевода для "${text}":`, error); return text; }
}

async function getTravelTime(originLatLng, destinationLatLng, departureTime) {
    let travelTimeResult = 'N/A';
    console.log(`DEBUG: Запрос времени Google Directions от ${JSON.stringify(originLatLng)} до ${JSON.stringify(destinationLatLng)} на ${departureTime.toISOString()}`);
    try {
        if (typeof google === 'undefined' || !google?.maps?.DirectionsService) { throw new Error("Google Directions Service not loaded."); }
        const service = new google.maps.DirectionsService();
        const request = { origin: originLatLng, destination: destinationLatLng, travelMode: google.maps.TravelMode.DRIVING, drivingOptions: { departureTime: departureTime, trafficModel: google.maps.TrafficModel.BEST_GUESS } };
        const result = await new Promise((resolve, reject) => {
            service.route(request, (response, status) => {
                if (status === google.maps.DirectionsStatus.OK) resolve(response);
                else reject(new Error(`Directions status: ${status}.`));
            });
        });
        if (result.routes?.[0]?.legs?.[0]) {
            const leg = result.routes[0].legs[0];
            travelTimeResult = leg.duration_in_traffic ? leg.duration_in_traffic.text : (leg.duration ? leg.duration.text : 'Время не найдено');
            const warnings = result.routes[0].warnings;
            if (warnings && warnings.length > 0) {
                const borderKeywords = ['border', 'границ', 'checkpoint', 'crossing', 'territories', 'territory', 'таможн'];
                if (warnings.some(w => typeof w === 'string' && borderKeywords.some(k => w.toLowerCase().includes(k.toLowerCase())))) {
                    travelTimeResult += " (ПРЕДУПРЕЖДЕНИЕ О ГРАНИЦЕ!)";
                }
            }
        } else { travelTimeResult = `Google: ${result.status || 'Маршрут не найден'}`; }
    } catch (error) { travelTimeResult = `Google: Ошибка (${error.message || 'Неизвестно'})`; }
    console.log(`DEBUG: Время в пути: ${travelTimeResult}`);
    return travelTimeResult;
}

// === ОСНОВНЫЕ ФУНКЦИИ ВИДЖЕТА ===
function initMap() {
    console.log("DEBUG: initMap()");
    const initialCoords = [31.771959, 35.217018]; const initialZoom = 8;
    try {
        map = L.map('map').setView(initialCoords, initialZoom);
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
            { name: "X", type: 'Numeric', optional: true, title: 'Старт похода Широта' },
            { name: "Y", type: 'Numeric', optional: true, title: 'Старт похода Долгота' },
            { name: "StartLabel", type: 'Text', optional: true, title: 'Название Старта похода' },

            { name: "A", type: 'Text', optional: true, title: 'Название Места встречи' },
            { name: "B", type: 'Numeric', title: 'Место встречи Широта' },
            { name: "C", type: 'Numeric', title: 'Место встречи Долгота' },
            
            { name: "D", type: 'Text', optional: true, title: 'Адрес Места встречи: Город' },
            { name: "E", type: 'Text', optional: true, title: 'Адрес Места встречи: Район' },
            { name: "F", type: 'Text', optional: true, title: 'Адрес Места встречи: Округ' },
            { name: "H", type: 'Text', optional: true, title: 'Адрес Места встречи: Микрорайон' },
            { name: "I", type: 'Text', optional: true, title: 'К Месту встречи: Время из Т-А' },
            { name: "J", type: 'Text', optional: true, title: 'К Месту встречи: Время из Иерус.' },
            { name: "K", type: 'Text', optional: true, title: 'К Месту встречи: Время из Хайфы' },
            { name: "L", type: 'Text', optional: true, title: 'К Месту встречи: Время из Б-Ш' },

            { name: "RouteStartLat", type: 'Numeric', optional: true, title: 'Старт маршрута Широта (клик)' },
            { name: "RouteStartLng", type: 'Numeric', optional: true, title: 'Старт маршрута Долгота (клик)' },
        ]
    });
    grist.onOptions(handleOptionsUpdate);
    grist.onRecord(handleGristRecordUpdate);
    console.log("DEBUG: Grist API готов.");
}

function handleOptionsUpdate(options, interaction) {
    console.log("DEBUG: Grist options:", options, "Interaction:", interaction);
    currentTableId = (options && options.tableId) || (interaction && interaction.tableId) || null;
    if (currentTableId) console.log(`DEBUG: Table ID: ${currentTableId}`);
    else console.warn("ПРЕДУПРЕЖДЕНИЕ: Table ID не найден.");
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
    console.log(`DEBUG: Маркер "${label}" ${markerInstance._leaflet_id ? 'обновлен' : 'создан'}.`);
    return markerInstance;
}

async function processMeetingPointData(lat, lng) {
    if (!currentRecordId || !currentTableId) {
        console.warn("ПРЕДУПРЕЖДЕНИЕ: Невозможно обработать данные Места встречи - нет ID записи/таблицы.");
        return;
    }
    console.log(`DEBUG: Обработка данных для Места встречи: ${lat}, ${lng}`);

    let cityLevel_ru = '', countyLevel_ru = '', stateLevel_ru = '', suburbLevel_ru = '';
    let travelTimeTA = 'N/A', travelTimeJerusalem = 'N/A', travelTimeHaifa = 'N/A', travelTimeBeersheba = 'N/A';

    const nominatimUrl = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1&accept-language=en`;
    try {
        const response = await fetch(nominatimUrl);
        if (!response.ok) throw new Error(`Nominatim error ${response.status}`);
        const data = await response.json();
        if (data && data.address) {
            const addr = data.address;
            const cityL = addr.city || addr.town || addr.village || addr.hamlet || '';
            const countyL = addr.county || addr.state_district || '';
            const stateL = addr.state || '';
            const suburbL = addr.suburb || addr.neighbourhood || addr.borough || addr.quarter || '';
            [cityLevel_ru, countyLevel_ru, stateLevel_ru, suburbLevel_ru] = await Promise.all([
                translateText(cityL, 'ru', apiKey),
                translateText(countyL, 'ru', apiKey),
                translateText(stateL, 'ru', apiKey),
                translateText(suburbL, 'ru', apiKey)
            ]);
        } else cityLevel_ru = "Адрес не найден";
    } catch (error) { console.error("ОШИБКА Nominatim/Translate:", error); cityLevel_ru = "Ошибка геокода"; }

    const departureDate = new Date();
    const currentDay = departureDate.getDay(); const currentHour = departureDate.getHours();
    let daysToAdd = (5 - currentDay + 7) % 7;
    if (daysToAdd === 0 && currentHour >= 7) daysToAdd = 7;
    departureDate.setDate(departureDate.getDate() + daysToAdd);
    departureDate.setHours(7, 0, 0, 0);

    const origins = [ {lat: 32.0853, lng: 34.7818}, {lat: 31.7683, lng: 35.2137}, {lat: 32.7940, lng: 34.9896}, {lat: 31.2530, lng: 34.7915} ];
    try {
        const results = await Promise.all(origins.map(orig => getTravelTime(orig, {lat, lng}, departureDate)));
        travelTimeTA = results[0] || 'N/A'; travelTimeJerusalem = results[1] || 'N/A';
        travelTimeHaifa = results[2] || 'N/A'; travelTimeBeersheba = results[3] || 'N/A';
    } catch (error) { console.error("ОШИБКА Google Directions (Promise.all):", error); }

    const updateData = {
        D: cityLevel_ru, E: countyLevel_ru, F: stateLevel_ru, H: suburbLevel_ru,
        I: travelTimeTA, J: travelTimeJerusalem, K: travelTimeHaifa, L: travelTimeBeersheba
    };
    Object.keys(updateData).forEach(key => (updateData[key] === undefined || updateData[key] === null || updateData[key] === '') && delete updateData[key]);

    try {
        await grist.docApi.applyUserActions([['UpdateRecord', currentTableId, currentRecordId, updateData]]);
        console.log("DEBUG: Данные адреса/времени для Места встречи обновлены в Grist.");
    } catch (error) { console.error("ОШИБКА обновления Grist (адрес/время Места встречи):", error); }
}


function handleGristRecordUpdate(record, mappings) {
    console.log("DEBUG: Grist record update:", record);
    if (!map) { console.warn("ПРЕДУПРЕЖДЕНИЕ: Карта не инициализирована."); return; }

    currentRecordId = record ? record.id : null;
    console.log("DEBUG: Current Record ID:", currentRecordId);

    if (hikeStartMarker) { hikeStartMarker.remove(); hikeStartMarker = null; }
    if (meetingPointMarker) { meetingPointMarker.remove(); meetingPointMarker = null; }
    if (routeStartMarker) { routeStartMarker.remove(); routeStartMarker = null; }

    if (!record) { console.log("DEBUG: Запись Grist не выбрана, маркеры удалены."); return; }

    // Маркер "Старт похода" (красный)
    if (typeof record.X === 'number' && typeof record.Y === 'number') {
        const label = record.StartLabel || `Старт похода (ID: ${record.id || 'N/A'})`;
        hikeStartMarker = updateOrCreateMarker(hikeStartMarker, { lat: record.X, lng: record.Y }, label, redIcon, true, onHikeStartMarkerDragEnd);
    }

    // Маркер "Место встречи" (синий)
    if (typeof record.B === 'number' && typeof record.C === 'number') {
        const label = record.A || `Место встречи (ID: ${record.id || 'N/A'})`;
        meetingPointMarker = updateOrCreateMarker(meetingPointMarker, { lat: record.B, lng: record.C }, label, blueIcon, true, onMeetingPointMarkerDragEnd);
        // Запускаем обработку данных (геокод, время) для места встречи, если его координаты есть
        processMeetingPointData(record.B, record.C);
    }

    // Маркер "Старт маршрута" (зеленый)
    if (typeof record.RouteStartLat === 'number' && typeof record.RouteStartLng === 'number') {
        const label = `Старт маршрута (ID: ${record.id || 'N/A'})`;
        routeStartMarker = updateOrCreateMarker(routeStartMarker, { lat: record.RouteStartLat, lng: record.RouteStartLng }, label, greenIcon, true, onRouteStartMarkerDragEnd);
    }
    
    const activeMarkers = [hikeStartMarker, meetingPointMarker, routeStartMarker].filter(m => m !== null);
    if (activeMarkers.length > 1) map.fitBounds(new L.featureGroup(activeMarkers).getBounds().pad(0.2));
    else if (activeMarkers.length === 1) map.flyTo(activeMarkers[0].getLatLng(), MARKER_ZOOM_LEVEL);
}

async function updateGristSimpleCoordinates(markerType, lat, lng) {
    if (!currentRecordId || !currentTableId) { console.warn(`ПРЕДУПРЕЖДЕНИЕ: Нет ID для обновления Grist (${markerType})`); return; }
    let updateData = {};
    if (markerType === 'hikeStart') updateData = { X: lat, Y: lng };
    else if (markerType === 'meetingPoint') updateData = { B: lat, C: lng };
    else if (markerType === 'routeStart') updateData = { RouteStartLat: lat, RouteStartLng: lng };
    else { console.error("ОШИБКА: Неизвестный тип маркера:", markerType); return; }

    try {
        await grist.docApi.applyUserActions([['UpdateRecord', currentTableId, currentRecordId, updateData]]);
        console.log(`DEBUG: Координаты Grist для "${markerType}" обновлены.`);
    } catch (error) { console.error(`ОШИБКА обновления Grist (${markerType}):`, error); }
}

function onHikeStartMarkerDragEnd(event) {
    const pos = event.target.getLatLng();
    console.log(`DEBUG: "Старт похода" перетащен: ${pos.lat}, ${pos.lng}`);
    updateGristSimpleCoordinates('hikeStart', pos.lat, pos.lng);
}

function onMeetingPointMarkerDragEnd(event) {
    const pos = event.target.getLatLng();
    console.log(`DEBUG: "Место встречи" перетащено: ${pos.lat}, ${pos.lng}`);
    updateGristSimpleCoordinates('meetingPoint', pos.lat, pos.lng);
    // После перетаскивания Места Встречи, запускаем полную обработку данных для него
    processMeetingPointData(pos.lat, pos.lng);
}

function onRouteStartMarkerDragEnd(event) {
    const pos = event.target.getLatLng();
    console.log(`DEBUG: "Старт маршрута" перетащен: ${pos.lat}, ${pos.lng}`);
    updateGristSimpleCoordinates('routeStart', pos.lat, pos.lng);
}

async function handleMapClick(e) {
    if (!e.latlng) { console.warn("ПРЕДУПРЕЖДЕНИЕ: Клик без координат."); return; }
    if (!currentRecordId) { alert("Сначала выберите строку в Grist."); return; }

    const lat = e.latlng.lat;
    const lng = e.latlng.lng;
    const clickPosition = { lat: lat, lng: lng };
    const tempLabel = `Старт маршрута (${lat.toFixed(4)}, ${lng.toFixed(4)})`;

    console.log(`DEBUG: Клик для установки "Старт маршрута": ${lat}, ${lng}`);
    routeStartMarker = updateOrCreateMarker(routeStartMarker, clickPosition, tempLabel, greenIcon, true, onRouteStartMarkerDragEnd);
    await updateGristSimpleCoordinates('routeStart', lat, lng); // Обновляем Grist только координатами
}

function checkApis() {
    const leafletReady = typeof L === 'object' && L.map;
    const googleReady = typeof google === 'object' && google.maps && google.maps.DirectionsService;
    console.log(`DEBUG: API check: Leaflet=${leafletReady}, Google Maps (Directions)=${googleReady}`);
    if (leafletReady && googleReady) initMap();
    else setTimeout(checkApis, 250);
}

console.log("DEBUG: grist_map_widget_hiking.js: Запуск checkApis.");
checkApis();
// === КОНЕЦ СКРИПТА ===
