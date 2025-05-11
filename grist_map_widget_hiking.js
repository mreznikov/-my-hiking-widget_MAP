// === ПОЛНЫЙ КОД JAVASCRIPT ВИДЖЕТА (Версия #152 - Финальная) ===

// === ГЛОБАЛЬНЫЕ ПЕРЕМЕННЫЕ ===
let map; // Объект Leaflet Map
let marker = null; // Объект Leaflet Marker
let currentRecordId = null; // ID выбранной строки Grist
let currentTableId = null;  // ID таблицы Grist
const apiKey = 'AIzaSyC-NbhYb2Dh4wRcJnVADh3KU7IINUa6pB8'; // Ваш ключ API для Google сервисов
const MARKER_ZOOM_LEVEL = 15; // Уровень зума при переходе к маркеру

// === ВСПОМОГАТЕЛЬНАЯ ФУНКЦИЯ ПЕРЕВОДА ===
/**
 * Переводит текст с помощью Google Cloud Translation API V2.
 */
async function translateText(text, targetLang, apiKey) {
    if (!text || typeof text !== 'string' || !text.trim()) { return ''; }
    const url = `https://translation.googleapis.com/language/translate/v2?key=${apiKey}`;
    console.log(`DEBUG: Requesting translation for: "${text}" to ${targetLang}`);
    try {
        const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' }, body: JSON.stringify({ q: text, target: targetLang }) });
        const responseBody = await response.text();
        console.log(`DEBUG: Translation API response status for "${text}": ${response.status}`);
        // console.log(`DEBUG: Translation API response body for "${text}": ${responseBody}`); // Раскомментируйте для детальной отладки ответа
        if (!response.ok) { throw new Error(`Translation API error ${response.status}`); }
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
 * @param {google.maps.LatLngLiteral} originLatLng - Координаты начала.
 * @param {google.maps.LatLngLiteral} destinationLatLng - Координаты конца.
 * @param {Date} departureTime - Время отправления.
 * @returns {Promise<string>} Промис, разрешающийся текстом времени в пути (или ошибкой).
 */
async function getTravelTime(originLatLng, destinationLatLng, departureTime) {
    let travelTimeResult = 'N/A'; // Значение по умолчанию
    console.log(`Requesting Google Directions from ${JSON.stringify(originLatLng)} to ${JSON.stringify(destinationLatLng)} for ${departureTime.toISOString()}`);

    try {
        if (!google?.maps?.DirectionsService) {
             throw new Error("Google Directions Service not loaded.");
        }
        const service = new google.maps.DirectionsService();
        const directionsRequest = {
            origin: originLatLng,
            destination: destinationLatLng,
            travelMode: google.maps.TravelMode.DRIVING,
            drivingOptions: {
                departureTime: departureTime,
                trafficModel: google.maps.TrafficModel.BEST_GUESS
            }
        };

        const directionsResult = await new Promise((resolve, reject) => {
            service.route(directionsRequest, (response, status) => {
                if (status === google.maps.DirectionsStatus.OK) {
                    resolve(response);
                } else {
                    reject(new Error(`Directions status: ${status}`));
                }
            });
        });
        console.log("Google Directions response:", directionsResult); // Логируем ответ для отладки

        if (directionsResult.routes?.[0]?.legs?.[0]) {
            const leg = directionsResult.routes[0].legs[0];
            travelTimeResult = leg.duration_in_traffic ? leg.duration_in_traffic.text : (leg.duration ? leg.duration.text : 'No duration');
            console.log(`Found travel time: ${travelTimeResult}`);

            const warnings = directionsResult.routes[0].warnings;
            if (warnings && warnings.length > 0) {
                 console.warn("DIRECTIONS WARNINGS FOUND:", warnings);
                 const borderKeywords = ['border', 'границ', 'checkpoint', 'crossing', 'territories', 'territory'];
                 const hasBorderWarning = warnings.some(w => borderKeywords.some(k => w.toLowerCase().includes(k)));
                 if (hasBorderWarning) {
                      console.error("!!! POTENTIAL BORDER/AREA A/B CROSSING WARNING DETECTED !!!");
                      travelTimeResult += " (ПРЕДУПРЕЖДЕНИЕ!)";
                 }
            } else { console.log("No route warnings."); }
        } else { travelTimeResult = `Google: ${directionsResult.status || 'No route/legs'}`; }

    } catch (error) {
        console.error("Google Directions request failed:", error);
        travelTimeResult = `Google: Error (${error.message})`;
    }
    return travelTimeResult;
}

// === ОСНОВНЫЕ ФУНКЦИИ ВИДЖЕТА ===

/**
 * Инициализация карты Leaflet.
 */
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

/**
 * Настройка взаимодействия с Grist API.
 */
function setupGrist() {
     if (typeof grist === 'undefined' || !grist.ready) { console.error("Grist API not found..."); return; }
     console.log("Setting up Grist interaction...");
    grist.ready({
        requiredAccess: 'full',
        columns: [ // Определяем все колонки A, B, C, D, E, F, H, I
            { name: "B", type: 'Numeric', title: 'Широта' },
            { name: "C", type: 'Numeric', title: 'Долгота' },
            { name: "A", type: 'Text', optional: true, title: 'Название (для метки)' },
            { name: "D", type: 'Text', optional: true, title: 'Город/Поселение (RU)' },
            { name: "E", type: 'Text', optional: true, title: 'Район (RU)' },
            { name: "F", type: 'Text', optional: true, title: 'Округ (RU)' },
            { name: "H", type: 'Text', optional: true, title: 'Микрорайон/Деревня (RU)' },
            { name: "I", type: 'Text', optional: true, title: 'Время в пути из Тель-Авива' }
        ]
    });
    grist.onOptions(handleOptionsUpdate);
    grist.onRecord(handleGristRecordUpdate);
    console.log("Grist API ready, listening for records and options...");
}

/**
 * Обрабатывает опции, переданные Grist (для tableId).
 */
function handleOptionsUpdate(options, interaction) {
    console.log("Grist: Received options update:", options);
    let foundTableId = null;
    if (options && options.tableId) { foundTableId = options.tableId; }
    else if (interaction && interaction.tableId) { foundTableId = interaction.tableId; }
    else if (options && options.tableRef) { foundTableId = options.tableRef; }
    if (foundTableId) { currentTableId = foundTableId; console.log(`Current Table ID set to: ${currentTableId}`); }
    else { console.warn("Could not find tableId in options/interaction."); currentTableId = null; }
}

/**
 * Обработчик данных из Grist при выборе строки.
 */
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
/**
 * Обрабатывает клик, получает адрес (Nominatim), ПЕРЕВОДИТ (Google),
 * получает ВРЕМЯ В ПУТИ из 4 городов (Google Directions Service),
 * обновляет маркер и запись в Grist (B..H, I, J, K, L).
 * @param {L.LeafletMouseEvent} e - Событие клика Leaflet
 */
async function handleMapClick(e) {
    if (!e.latlng) return;

    const lat = e.latlng.lat;
    const lng = e.latlng.lng;
    const position = { lat: lat, lng: lng };
    const positionLeaflet = e.latlng;
    const destinationLatLngGoogle = { lat: lat, lng: lng }; // Пункт назначения для Google
    const tempLabel = `Processing... (${lat.toFixed(4)}, ${lng.toFixed(4)})`;

    console.log("Map clicked at:", position);
    updateMarkerOnMap(positionLeaflet, tempLabel);

    // --- Переменные ---
    let cityLevel_local = '', countyLevel_local = '', stateLevel_local = '', suburbLevel_local = '';
    let cityLevel_ru = '', countyLevel_ru = '', stateLevel_ru = '', suburbLevel_ru = '';
    let travelTimeTA = 'N/A', travelTimeJerusalem = 'N/A', travelTimeHaifa = 'N/A', travelTimeBeersheba = 'N/A';

    // --- 1. Геокодирование Nominatim & 2. Перевод Google Translate ---
    const nominatimUrl = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=18`;
    console.warn("Using Nominatim public API...");
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
            console.log(`Found Nominatim (local): City='${cityLevel_local}', County='${countyLevel_local}', State='${stateLevel_local}', Suburb/Village(H)='${suburbLevel_local}'`);

            console.log("Translating names to Russian...");
            [cityLevel_ru, countyLevel_ru, stateLevel_ru, suburbLevel_ru] = await Promise.all([
                translateText(cityLevel_local, 'ru', apiKey),
                translateText(countyLevel_local, 'ru', apiKey),
                translateText(stateLevel_local, 'ru', apiKey),
                translateText(suburbLevel_local, 'ru', apiKey)
            ]);
             console.log(`Translated components: City(D)='${cityLevel_ru}', County(E)='${countyLevel_ru}', State(F)='${stateLevel_ru}', Suburb/Village(H)='${suburbLevel_ru}'`);
        } else { console.warn("Nominatim returned no address data."); }
    } catch (error) { console.error("Reverse geocoding or Translation failed:", error); }


    // --- 3. Расчет времени через Google Directions Service для 4 городов ---
    const departureDate = new Date(); // Используем текущее время + логику для пятницы 7 утра
    const currentDay = departureDate.getDay();
    const currentHour = departureDate.getHours();
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

    // Выполняем запросы параллельно
    try {
        const results = await Promise.all(
             origins.map(origin => getTravelTime(origin.coords, destinationLatLngGoogle, departureDate))
        );
        travelTimeTA = results[0] || 'N/A';
        travelTimeJerusalem = results[1] || 'N/A';
        travelTimeHaifa = results[2] || 'N/A';
        travelTimeBeersheba = results[3] || 'N/A';
        console.log(`Travel times received: TA=${travelTimeTA}, Jeru=${travelTimeJerusalem}, Haifa=${travelTimeHaifa}, BeerS=${travelTimeBeersheba}`);
    } catch (error) {
         // Promise.all отклоняется, если хотя бы один запрос неудачен
         // Ошибки уже залогированы внутри getTravelTime
         console.error("One or more Directions requests failed.", error);
         travelTimeTA = travelTimeTA === 'N/A' ? 'Google: Error' : travelTimeTA; // Помечаем как ошибку, если еще N/A
         travelTimeJerusalem = travelTimeJerusalem === 'N/A' ? 'Google: Error' : travelTimeJerusalem;
         travelTimeHaifa = travelTimeHaifa === 'N/A' ? 'Google: Error' : travelTimeHaifa;
         travelTimeBeersheba = travelTimeBeersheba === 'N/A' ? 'Google: Error' : travelTimeBeersheba;
    }

    // --- 4. Обновление Grist ---
    const finalLabel = cityLevel_ru ? `${cityLevel_ru}, ${stateLevel_ru}` : `(${lat.toFixed(4)}, ${lng.toFixed(4)})`;
    updateMarkerOnMap(positionLeaflet, finalLabel);

    let tableIdToUse = currentTableId;
    try { if (grist.selectedTable?.getTableId) { const id = await grist.selectedTable.getTableId(); if (id) tableIdToUse = id;} } catch(e) {}

    if (currentRecordId !== null && tableIdToUse !== null && typeof tableIdToUse === 'string') {
        console.log(`Attempting update Grist record: ${currentRecordId} in table: ${tableIdToUse}`);
        try {
            if (!grist.docApi?.applyUserActions) { throw new Error("Grist docApi not available"); }
            const tableId = tableIdToUse;
            // Записываем все данные B, C, D, E, F, H, I, J, K, L
            const updateData = {
                'B': lat,                 'C': lng,
                'D': cityLevel_ru,        'E': countyLevel_ru,
                'F': stateLevel_ru,       'H': suburbLevel_ru,
                'I': travelTimeTA,        // Время из ТА
                'J': travelTimeJerusalem, // Время из Иерусалима
                'K': travelTimeHaifa,     // Время из Хайфы
                'L': travelTimeBeersheba  // Время из Беэр-Шевы
            };
            const userActions = [ ['UpdateRecord', tableId, currentRecordId, updateData] ];
            console.log("Applying user actions:", userActions);
            await grist.docApi.applyUserActions(userActions); // Проверьте среду!
            console.log(`Grist record ${currentRecordId} update action sent successfully.`);
        } catch (error) {
             console.error(`Failed to apply user actions:`, error);
             alert(`Ошибка обновления Grist: ${error.message}`);
        }
    } else { /* ... обработка невозможности обновления ... */ }
}


/**
 * Создает или обновляет маркер Leaflet и приближает карту.
 */
function updateMarkerOnMap(position, label) {
    // ... (код без изменений) ...
}

// === БЛОК РУЧНОЙ ИНИЦИАЛИЗАЦИИ (Ждем Leaflet И Google Maps) ===
function checkApis() {
    // ... (код без изменений) ...
}
// === ТОЧКА ВХОДА (ПРЯМОЙ ВЫЗОВ ПРОВЕРКИ API) ===
console.log("DEBUG: Calling checkApis directly now.");
checkApis();
console.log("grist_map_widget.js executed.");
// === КОНЕЦ СКРИПТА ===

/**
 * Создает или обновляет маркер Leaflet и приближает карту.
 */
function updateMarkerOnMap(position, label) {
    // ... (код из ответа #131 - с flyTo) ...
     if (!map) return;
     const latLng = L.latLng(position);
     if (!marker) { marker = L.marker(latLng, { title: label }).addTo(map); }
     else { marker.setLatLng(latLng); if (marker.getElement()) marker.getElement().title = label; if (!map.hasLayer(marker)) marker.addTo(map); }
     map.flyTo(latLng, MARKER_ZOOM_LEVEL);
     console.log(`Leaflet Marker updated/created. Pos: ${latLng.toString()}, Label: "${label}"`);
}

// === БЛОК РУЧНОЙ ИНИЦИАЛИЗАЦИИ (Ждем Leaflet И Google Maps) ===
/**
 * Проверяет готовность API Leaflet и Google Maps.
 */
function checkApis() {
    console.log("DEBUG: === ENTERING checkApis ===");
    const leafletReady = typeof L === 'object' && L !== null && typeof L.map === 'function';
    const googleReady = typeof google === 'object' && typeof google.maps === 'object' && typeof google.maps.DirectionsService === 'function'; // Проверяем DirectionsService
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
checkApis(); // Запускаем проверку обеих библиотек

console.log("grist_map_widget.js executed.");
// === КОНЕЦ СКРИПТА ===
