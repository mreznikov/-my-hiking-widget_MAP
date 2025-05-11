// === ПОЛНЫЙ КОД JAVASCRIPT ВИДЖЕТА (Версия #211b - Полная - Множественные расчеты времени) ===

// === ГЛОБАЛЬНЫЕ ПЕРЕМЕННЫЕ ===
let map; // Объект Leaflet Map
let marker = null; // Объект Leaflet Marker (для отображения клика/выбранной строки)
let currentRecordId = null; // ID выбранной строки Grist
let currentTableId = null;  // ID таблицы Grist
const apiKey = 'AIzaSyC-NbhYb2Dh4wRcJnVADh3KU7IINUa6pB8'; // Ваш ключ API для Google сервисов
const MARKER_ZOOM_LEVEL = 15; // Уровень зума при переходе к маркеру

// === ВСПОМОГАТЕЛЬНАЯ ФУНКЦИЯ ПЕРЕВОДА ===
async function translateText(text, targetLang, apiKey) {
    if (!text || typeof text !== 'string' || !text.trim()) { return ''; }
    const url = `https://translation.googleapis.com/language/translate/v2?key=${apiKey}`;
    console.log(`DEBUG: Requesting translation for: "${text}" to ${targetLang}`);
    try {
        const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' }, body: JSON.stringify({ q: text, target: targetLang }) });
        const responseBody = await response.text();
        console.log(`DEBUG: Translation API response status for "${text}": ${response.status}`);
        if (!response.ok) {
            let errorMsg = `Translation API error ${response.status}`;
            try { const errorData = JSON.parse(responseBody); errorMsg += `: ${errorData?.error?.message || responseBody}`; }
            catch(e) { errorMsg += `: ${responseBody}`; }
            throw new Error(errorMsg);
        }
        const data = JSON.parse(responseBody);
        if (data?.data?.translations?.[0]?.translatedText) {
            const translated = data.data.translations[0].translatedText;
            console.log(`Translation successful: "${text}" -> "${translated}"`);
            const tempElem = document.createElement('textarea'); tempElem.innerHTML = translated; return tempElem.value;
        } else { console.warn(`Translation API unexpected structure for "${text}"`); return text; }
    } catch (error) { console.error(`Translation fetch failed for "${text}":`, error); return text; }
}

/**
 * Получает время в пути и проверяет предупреждения для одного маршрута.
 */
async function getTravelTime(originLatLng, destinationLatLng, departureTime) {
    let travelTimeResult = 'N/A';
    console.log(`Requesting Google Directions from ${JSON.stringify(originLatLng)} to ${JSON.stringify(destinationLatLng)} for ${departureTime.toISOString()}`);
    try {
        if (!google?.maps?.DirectionsService) { throw new Error("Google Directions Service not loaded."); }
        const service = new google.maps.DirectionsService();
        const directionsRequest = {
            origin: originLatLng,
            destination: destinationLatLng,
            travelMode: google.maps.TravelMode.DRIVING,
            drivingOptions: { departureTime: departureTime, trafficModel: google.maps.TrafficModel.BEST_GUESS }
        };
        const directionsResult = await new Promise((resolve, reject) => {
            service.route(directionsRequest, (response, status) => {
                if (status === google.maps.DirectionsStatus.OK) { resolve(response); }
                else { reject(new Error(`Directions status: ${status}`)); }
            });
        });
        console.log("Google Directions response:", directionsResult);
        if (directionsResult.routes?.[0]?.legs?.[0]) {
            const leg = directionsResult.routes[0].legs[0];
            travelTimeResult = leg.duration_in_traffic ? leg.duration_in_traffic.text : (leg.duration ? leg.duration.text : 'No duration');
            console.log(`Found travel time: ${travelTimeResult}`);
            const warnings = directionsResult.routes[0].warnings;
            if (warnings && warnings.length > 0) {
                 console.warn("DIRECTIONS WARNINGS FOUND:", warnings);
                 const borderKeywords = ['border', 'границ', 'checkpoint', 'crossing', 'territories', 'territory'];
                 if (warnings.some(w => borderKeywords.some(k => w.toLowerCase().includes(k)))) {
                     console.error("!!! POTENTIAL BORDER/AREA A/B CROSSING WARNING DETECTED !!!");
                     travelTimeResult += " (ПРЕДУПРЕЖДЕНИЕ!)";
                 }
            } else { console.log("No route warnings."); }
        } else { travelTimeResult = `Google: ${directionsResult.status || 'No route/legs'}`; }
    } catch (error) { console.error("Google Directions request failed:", error); travelTimeResult = `Google: Error (${error.message})`; }
    return travelTimeResult;
}

// === ОСНОВНЫЕ ФУНКЦИИ ВИДЖЕТА ===

function initMap() {
    console.log("Leaflet initMap() called.");
    const initialCoords = [31.5, 34.8]; const initialZoom = 7;
    try {
        const mapDiv = document.getElementById('map');
        if (!mapDiv) { console.error("Map container #map not found!"); return; }
        map = L.map('map').setView(initialCoords, initialZoom);
        console.log("Leaflet Map object created.");
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19,
            attribution: 'Map data &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        }).addTo(map);
        console.log("OSM TileLayer added.");
        map.on('click', handleMapClick);
        console.log("Leaflet map click listener added.");
        setupGrist();
    } catch (e) { console.error("Error creating Leaflet Map object:", e); }
}

function setupGrist() {
     if (typeof grist === 'undefined' || !grist.ready) { console.error("Grist API not found..."); return; }
     console.log("Setting up Grist interaction...");
    grist.ready({
        requiredAccess: 'full',
        columns: [
            { name: "B", type: 'Numeric', title: 'Широта' },
            { name: "C", type: 'Numeric', title: 'Долгота' },
            { name: "A", type: 'Text', optional: true, title: 'Название (для метки)' },
            { name: "D", type: 'Text', optional: true, title: 'Город/Поселение (RU)' },
            { name: "E", type: 'Text', optional: true, title: 'Район (RU)' },
            { name: "F", type: 'Text', optional: true, title: 'Округ (RU)' },
            { name: "H", type: 'Text', optional: true, title: 'Микрорайон/Деревня (RU)' },
            { name: "I", type: 'Text', optional: true, title: 'Время в пути из Тель-Авива' },
            { name: "J", type: 'Text', optional: true, title: 'Время в пути из Иерусалима' },
            { name: "K", type: 'Text', optional: true, title: 'Время в пути из Хайфы' },
            { name: "L", type: 'Text', optional: true, title: 'Время в пути из Бер-Шевы' }
        ]
    });
    grist.onOptions(handleOptionsUpdate);
    grist.onRecord(handleGristRecordUpdate);
    console.log("Grist API ready, listening for records and options...");
}

function handleOptionsUpdate(options, interaction) {
    console.log("Grist: Received options update:", options);
    let foundTableId = null;
    if (options && options.tableId) { foundTableId = options.tableId; }
    else if (interaction && interaction.tableId) { foundTableId = interaction.tableId; }
    else if (options && options.tableRef) { foundTableId = String(options.tableRef); }
    if (foundTableId) { currentTableId = String(foundTableId); console.log(`Current Table ID set to: ${currentTableId}`);}
    else { console.warn("Could not find tableId in options/interaction."); currentTableId = null; }
}

function handleGristRecordUpdate(record, mappings) {
     console.log("Grist: Received record update:", record);
    if (!map) { return; }
    currentRecordId = record ? record.id : null;
    console.log("Current selected record ID:", currentRecordId);
    if (!record || typeof record.id === 'undefined') { if (marker) { marker.remove(); marker = null; } return; }
    const lat = record.B; const lng = record.C;
    const label = record.A || record.D || `ID: ${record.id}`;
    if (typeof lat === 'number' && !isNaN(lat) && typeof lng === 'number' && !isNaN(lng)) {
        updateMarkerOnMap({ lat: lat, lng: lng }, label);
    } else { if (marker) { marker.remove(); marker = null; } }
}

async function handleMapClick(e) {
    if (!e.latlng) return;

    const lat = e.latlng.lat;
    const lng = e.latlng.lng;
    const positionLeaflet = e.latlng;
    const destinationLatLngGoogle = { lat: lat, lng: lng };
    const tempLabel = `Processing... (${lat.toFixed(4)}, ${lng.toFixed(4)})`;

    console.log("Map clicked at:", { lat, lng });
    updateMarkerOnMap(positionLeaflet, tempLabel);

    let cityLevel_local = '', countyLevel_local = '', stateLevel_local = '', suburbLevel_local = '';
    let cityLevel_ru = '', countyLevel_ru = '', stateLevel_ru = '', suburbLevel_ru = '';
    let travelTimeTA = 'N/A', travelTimeJerusalem = 'N/A', travelTimeHaifa = 'N/A', travelTimeBeersheba = 'N/A';

    const nominatimUrl = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=18`;
    try {
        const response = await fetch(nominatimUrl);
        if (!response.ok) throw new Error(`Nominatim status ${response.status}`);
        const data = await response.json();
        if (data && data.address) {
            const addr = data.address;
            cityLevel_local = addr.city || addr.town || addr.village || addr.hamlet || '';
            countyLevel_local = addr.county || addr.state_district || '';
            stateLevel_local = addr.state || '';
            suburbLevel_local = addr.suburb || addr.village || '';
            [cityLevel_ru, countyLevel_ru, stateLevel_ru, suburbLevel_ru] = await Promise.all([
                translateText(cityLevel_local, 'ru', apiKey),
                translateText(countyLevel_local, 'ru', apiKey),
                translateText(stateLevel_local, 'ru', apiKey),
                translateText(suburbLevel_local, 'ru', apiKey)
            ]);
        }
    } catch (error) { console.error("Nominatim/Translation failed:", error); }

    const departureDate = new Date();
    const currentDay = departureDate.getDay(); const currentHour = departureDate.getHours();
    let daysToAdd = (5 - currentDay + 7) % 7;
    if (daysToAdd === 0 && currentHour >= 7) { daysToAdd = 7; }
    departureDate.setDate(departureDate.getDate() + daysToAdd);
    departureDate.setHours(7, 0, 0, 0);
    console.log(`Calculating travel times for departure: ${departureDate.toString()}`);

    const origins = [
        { name: 'TA', coords: { lat: 32.0853, lng: 34.7818 } },
        { name: 'Jerusalem', coords: { lat: 31.7683, lng: 35.2137 } },
        { name: 'Haifa', coords: { lat: 32.7940, lng: 34.9896 } },
        { name: 'Beersheba', coords: { lat: 31.2530, lng: 34.7915 } }
    ];

    try {
        const results = await Promise.all(
            origins.map(origin => getTravelTime(origin.coords, destinationLatLngGoogle, departureDate))
        );
        travelTimeTA = results[0] || 'N/A';
        travelTimeJerusalem = results[1] || 'N/A';
        travelTimeHaifa = results[2] || 'N/A';
        travelTimeBeersheba = results[3] || 'N/A';
    } catch (error) {
        console.error("One or more Directions requests failed overall:", error);
        // results will contain undefined for failed ones, getTravelTime already sets default error strings
    }

    const finalLabel = cityLevel_ru ? `${cityLevel_ru}, ${stateLevel_ru}` : `(${lat.toFixed(4)}, ${lng.toFixed(4)})`;
    updateMarkerOnMap(positionLeaflet, finalLabel);

    let tableIdToUse = currentTableId;
    if (!tableIdToUse && grist.selectedTable?.getTableId) {
        try { const id = await grist.selectedTable.getTableId(); if (id) tableIdToUse = id; currentTableId = tableIdToUse;}
        catch(e) { console.error("Error getting tableId for update:", e); }
    }

    if (currentRecordId !== null && tableIdToUse && typeof tableIdToUse === 'string') {
        const updateData = {
            'B': lat, 'C': lng,
            'D': cityLevel_ru, 'E': countyLevel_ru,
            'F': stateLevel_ru, 'H': suburbLevel_ru,
            'I': travelTimeTA, 'J': travelTimeJerusalem,
            'K': travelTimeHaifa, 'L': travelTimeBeersheba
        };
        const userActions = [ ['UpdateRecord', tableIdToUse, currentRecordId, updateData] ];
        try {
            if (!grist.docApi?.applyUserActions) { throw new Error("Grist docApi not available"); }
            await grist.docApi.applyUserActions(userActions);
            console.log(`Grist record ${currentRecordId} update action sent successfully.`);
        } catch (error) { console.error(`Failed to apply user actions:`, error); alert(`Ошибка обновления Grist: ${error.message}`);}
    } else {
        console.warn("Cannot update Grist record: currentRecordId or tableIdToUse is invalid.", {currentRecordId, tableIdToUse});
        if (!currentRecordId) alert("Строка в Grist не выбрана для обновления.");
        else alert("Не удалось определить таблицу для обновления.");
    }
}

function updateMarkerOnMap(position, label) {
    if (!map) return;
    const latLng = L.latLng(position);
    if (!marker) { marker = L.marker(latLng, { title: label }).addTo(map); }
    else { marker.setLatLng(latLng); if (marker.getElement()) marker.getElement().title = label; if (!map.hasLayer(marker)) marker.addTo(map); }
    map.flyTo(latLng, MARKER_ZOOM_LEVEL);
    console.log(`Leaflet Marker updated/created. Pos: ${latLng.toString()}, Label: "${label}"`);
}

// === БЛОК РУЧНОЙ ИНИЦИАЛИЗАЦИИ (Ждем Leaflet И Google Maps) ===
function checkApis() {
    console.log("DEBUG: === ENTERING checkApis ===");
    const leafletReady = typeof L === 'object' && L !== null && typeof L.map === 'function';
    const googleReady = typeof google === 'object' && typeof google.maps === 'object' && typeof google.maps.DirectionsService === 'function';
    console.log(`DEBUG: Leaflet ready = ${leafletReady}, Google Maps ready = ${googleReady}`);
   if (leafletReady && googleReady) {
       console.log("DEBUG: Both APIs check PASSED.");
       initMap();
   } else {
       console.warn("DEBUG: APIs check FAILED. Retrying shortly...");
       setTimeout(checkApis, 250);
   }
    console.log("DEBUG: === EXITING checkApis (may retry via timeout) ===");
}

// === ТОЧКА ВХОДА (ПРЯМОЙ ВЫЗОВ ПРОВЕРКИ API) ===
console.log("DEBUG: Calling checkApis directly now.");
checkApis();
console.log("grist_map_widget.js executed.");
// === КОНЕЦ СКРИПТА ===
