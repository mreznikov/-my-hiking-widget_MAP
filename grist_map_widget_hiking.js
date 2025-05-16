// === ПОЛНЫЙ КОД JAVASCRIPT ВИДЖЕТА (Версия: v9.9.30 - Улучшенное логирование latlngs) ===

// === ГЛОБАЛЬНЫЕ ПЕРЕМЕННЫЕ ===
let map;
let meetingPointMarker = null; // Синий - Место встречи (из B,C)
let routeStartMarker = null;   // Зеленый - Старт маршрута (из X,Y)
let endRouteMarker = null;     // Пурпурный - Конец маршрута (из Z,AA)
let israelHikingPolyline = null; // Для маршрута с Israel Hiking Map

let currentRecordId = null;
let currentTableId = null;
const HARDCODED_TABLE_ID = "Table1"; // Запасной ID таблицы, если не получен от Grist
const apiKey = 'AIzaSyC-NbhYb2Dh4wRcJnVADh3KU7IINUa6pB8'; // ВАШ API КЛЮЧ GOOGLE!
const MARKER_ZOOM_LEVEL = 15; // Уровень масштабирования при фокусировке на одном маркере

let meetingPointJustUpdatedByAction = false; // Флаг, что данные места встречи были только что обновлены действием пользователя (клик, перетаскивание)
let lastProcessedRecordIdForMeetingPoint = null; // ID последней записи, для которой обрабатывались данные места встречи

const GOOGLE_MAPS_BASE_URL_FOR_PLACE = 'https://www.google.com/maps/place/'; // Базовый URL для ссылок на Google Maps

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

// === ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ===
async function translateText(text, targetLang, apiKey) {
    if (!text || typeof text !== 'string' || !text.trim()) {
        console.warn("DEBUG: translateText: Пустой текст для перевода.");
        return '';
    }
    const url = `https://translation.googleapis.com/language/translate/v2?key=${apiKey}`;
    console.log(`DEBUG: translateText: "${text}" to ${targetLang}`);
    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
            body: JSON.stringify({ q: text, target: targetLang })
        });
        const responseBodyText = await response.text();
        console.log(`DEBUG: translateText status for "${text}": ${response.status}, response: ${responseBodyText}`);
        if (!response.ok) { throw new Error(`Translation API error ${response.status}. Response: ${responseBodyText}`); }
        const data = JSON.parse(responseBodyText);
        if (data?.data?.translations?.[0]?.translatedText) {
            const translated = data.data.translations[0].translatedText;
            console.log(`DEBUG: translateText success: "${text}" -> "${translated}"`);
            const textarea = document.createElement('textarea');
            textarea.innerHTML = translated;
            return textarea.value;
        } else {
            console.warn(`DEBUG: translateText no translation found for "${text}" in response data:`, data);
            return text;
        }
    } catch (error) {
        console.error(`DEBUG: translateText failed for "${text}":`, error);
        return text;
    }
}

async function getTravelTime(originLatLng, destinationLatLng, departureTime) {
    let travelTimeResult = 'N/A';
    console.log(`DEBUG: getTravelTime from ${JSON.stringify(originLatLng)} to ${JSON.stringify(destinationLatLng)} at ${departureTime.toISOString()}`);
    try {
        if (typeof google === 'undefined' || !google?.maps?.DirectionsService) { throw new Error("Google Directions Service not loaded."); }
        const directionsService = new google.maps.DirectionsService();
        const request = {
            origin: originLatLng,
            destination: destinationLatLng,
            travelMode: google.maps.TravelMode.DRIVING,
            drivingOptions: { departureTime: departureTime, trafficModel: google.maps.TrafficModel.BEST_GUESS }
        };
        const result = await new Promise((resolve, reject) => {
            directionsService.route(request, (response, status) => {
                if (status === google.maps.DirectionsStatus.OK) { resolve(response); }
                else { reject(new Error(`Directions API status: ${status}. Request: ${JSON.stringify(request)}`)); }
            });
        });
        if (result.routes?.[0]?.legs?.[0]) {
            const leg = result.routes[0].legs[0];
            travelTimeResult = leg.duration_in_traffic?.text || leg.duration?.text || 'Время не найдено';
            if (result.routes[0].warnings?.some(w => typeof w === 'string' && ['border', 'границ', 'checkpoint', 'crossing', 'territories', 'territory', 'таможн'].some(keyword => w.toLowerCase().includes(keyword.toLowerCase())))) {
                travelTimeResult += " (ПРЕДУПРЕЖДЕНИЕ О ГРАНИЦЕ!)";
            }
        } else { travelTimeResult = `Google: Маршрут не найден (статус OK)`; }
    } catch (error) {
        travelTimeResult = `Google: Ошибка (${error.message || 'Неизвестная ошибка API'})`;
        console.error("DEBUG: getTravelTime error:", error);
    }
    console.log(`DEBUG: getTravelTime result: ${travelTimeResult}`);
    return travelTimeResult;
}

async function fetchAndDisplayIsraelHikingRoute(routeId) {
    if (!routeId) {
        console.warn("DEBUG (Israel Hiking): routeId не предоставлен. Очистка полилайна, если существует.");
        if (israelHikingPolyline && map.hasLayer(israelHikingPolyline)) { map.removeLayer(israelHikingPolyline); }
        israelHikingPolyline = null;
        return;
    }
    console.log(`DEBUG (Israel Hiking): Начало fetchAndDisplayIsraelHikingRoute для ID: ${routeId}`);
    const apiUrl = `https://israelhiking.osm.org.il/api/Urls/${routeId}`;
    console.log(`DEBUG (Israel Hiking): Формирование URL API: ${apiUrl}`);
    try {
        console.log(`DEBUG (Israel Hiking): Отправка запроса к API: ${apiUrl}`);
        const response = await fetch(apiUrl);
        const responseStatus = response.status;
        const responseOk = response.ok;
        console.log(`DEBUG (Israel Hiking): Получен ответ от API. Статус: ${responseStatus}, OK: ${responseOk}`);
        if (!responseOk) {
            const errorText = await response.text();
            console.error(`DEBUG (Israel Hiking): Ошибка API. Статус: ${responseStatus}, Текст ошибки: ${errorText}`);
            throw new Error(`Israel Hiking API error ${responseStatus}: ${errorText}. URL: ${apiUrl}`);
        }
        const data = await response.json();
        console.log(`DEBUG (Israel Hiking): Ответ API успешно распарсен в JSON.`);
        // --- Начало улучшенного логирования ---
        console.log(`DEBUG (Israel Hiking): Полный объект data, полученный от API (глубокая копия):`, JSON.parse(JSON.stringify(data)));

        if (data && data.hasOwnProperty('latlngs')) {
            console.log(`DEBUG (Israel Hiking): Ключ 'latlngs' СУЩЕСТВУЕТ в объекте data.`);
            console.log(`DEBUG (Israel Hiking): Тип data.latlngs: ${typeof data.latlngs}`);
            console.log(`DEBUG (Israel Hiking): Является ли data.latlngs массивом: ${Array.isArray(data.latlngs)}`);
            if (Array.isArray(data.latlngs)) {
                console.log(`DEBUG (Israel Hiking): Длина массива data.latlngs: ${data.latlngs.length}`);
                if (data.latlngs.length > 0) {
                    console.log(`DEBUG (Israel Hiking): Первый элемент data.latlngs (если есть):`, data.latlngs[0]);
                }
            } else {
                console.log(`DEBUG (Israel Hiking): data.latlngs НЕ является массивом. Значение:`, data.latlngs);
            }
        } else {
            console.log(`DEBUG (Israel Hiking): Ключ 'latlngs' ОТСУТСТВУЕТ в объекте data. Ключи объекта data: ${data ? Object.keys(data).join(', ') : 'data is null/undefined'}`);
        }
        // --- Конец улучшенного логирования ---

        if (israelHikingPolyline && map.hasLayer(israelHikingPolyline)) {
            console.log(`DEBUG (Israel Hiking): Удаление существующего полилайна Israel Hiking Map.`);
            map.removeLayer(israelHikingPolyline);
        }
        israelHikingPolyline = null;

        // Используем более строгую проверку
        if (data && Array.isArray(data.latlngs) && data.latlngs.length > 0) {
            console.log(`DEBUG (Israel Hiking): Условие для отрисовки пройдено. Найдено ${data.latlngs.length} точек.`);
            const latLngsArray = data.latlngs.map(point => [point.lat, point.lng]);
            console.log(`DEBUG (Israel Hiking): Точки маршрута преобразованы в формат Leaflet.`);
            if (latLngsArray.length > 0) { console.log(`DEBUG (Israel Hiking): Пример первых 3 точек: ${JSON.stringify(latLngsArray.slice(0,3))}`); }
            israelHikingPolyline = L.polyline(latLngsArray, { color: 'red', weight: 3, opacity: 0.8 });
            console.log(`DEBUG (Israel Hiking): Объект L.polyline создан.`);
            israelHikingPolyline.addTo(map);
            console.log(`DEBUG (Israel Hiking): Полилайн маршрута Israel Hiking Map добавлен на карту.`);
        } else {
            console.warn(`DEBUG (Israel Hiking): Условие для отрисовки НЕ пройдено. Проверьте предыдущие логи по 'latlngs'. ID: ${routeId}. Объект data (как он есть):`, data);
        }
    } catch (error) {
        console.error(`DEBUG (Israel Hiking): Ошибка при загрузке или отображении маршрута Israel Hiking Map для ID: ${routeId}`, error);
        if (israelHikingPolyline && map.hasLayer(israelHikingPolyline)) { map.removeLayer(israelHikingPolyline); }
        israelHikingPolyline = null;
    }
    console.log(`DEBUG (Israel Hiking): Завершение fetchAndDisplayIsraelHikingRoute для ID: ${routeId}`);
}

// === ОСНОВНЫЕ ФУНКЦИИ ===
function initMap() {
    console.log("DEBUG: initMap()");
    try {
        map = L.map('map').setView([31.771959, 35.217018], 8);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19, attribution: '© <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        }).addTo(map);
        map.on('click', handleMapClick);
        setupGrist();
    } catch (e) {
        console.error("ОШИБКА initMap:", e);
        document.getElementById('map').innerHTML = '<p style="color:red; text-align:center; padding-top: 20px;">Ошибка инициализации карты. Подробности в консоли.</p>';
    }
}

function setupGrist() {
    if (typeof grist === 'undefined' || !grist.ready) {
        console.error("ОШИБКА: Grist API не готов. Повторная попытка через 500мс.");
        setTimeout(setupGrist, 500);
        return;
    }
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
            { name: "GoogleDrive", type: 'Text', optional: true, title: 'Место встреч. Google Карта ссылка' },
            { name: "Waze", type: 'Text', optional: true, title: 'Место встреч. Waze ссылка' },
            { name: "D", type: 'Text', optional: true, title: 'Адрес Места встречи: Город' },
            { name: "E", type: 'Text', optional: true, title: 'Адрес Места встречи: Район' },
            { name: "F", type: 'Text', optional: true, title: 'Адрес Места встречи: Округ' },
            { name: "H_Meeting", type: 'Text', optional: true, title: 'Адрес Места встречи: Микрорайон/Окрестность' },
            { name: "I", type: 'Text', optional: true, title: 'К Месту встречи: Время из Тель-Авива' },
            { name: "J", type: 'Text', optional: true, title: 'К Месту встречи: Время из Иерусалима' },
            { name: "K", type: 'Text', optional: true, title: 'К Месту встречи: Время из Хайфы' },
            { name: "L", type: 'Text', optional: true, title: 'К Месту встречи: Время из Беэр-Шевы' },
            { name: "Z", type: 'Numeric', optional: true, title: 'Конец маршрута Широта' },
            { name: "AA", type: 'Numeric', optional: true, title: 'Конец маршрута Долгота' },
            { name: "EndRouteLabel", type: 'Text', optional: true, title: 'Название Конца маршрута' },
            { name: "R", type: 'Text', optional: true, title: 'Ссылка Israel Hiking Map' }
        ]
    });
    grist.onOptions(handleOptionsUpdate);
    grist.onRecord(handleGristRecordUpdate);
    console.log("DEBUG: Grist API готов и подписки установлены.");
}

function handleOptionsUpdate(options, interaction) {
    console.log("DEBUG: Grist options update:", options, "Interaction:", interaction);
    currentTableId = (options?.tableId) || (interaction?.tableId) || currentTableId || null;
    if (currentTableId) { console.log(`DEBUG: Table ID установлен/обновлен через onOptions: ${currentTableId}`); }
    else { console.warn("ПРЕДУПРЕЖДЕНИЕ: Table ID не был предоставлен через grist.onOptions."); }
}

async function getEnsuredTableId() {
    if (currentTableId) { return currentTableId; }
    console.log("DEBUG: getEnsuredTableId - currentTableId is null, пытаемся получить через grist.selectedTable.getTableId()");
    if (grist.selectedTable && typeof grist.selectedTable.getTableId === 'function') {
        try {
            const id = await grist.selectedTable.getTableId();
            if (id) {
                currentTableId = id;
                console.log(`DEBUG: getEnsuredTableId - Table ID получен и кэширован через selectedTable: ${currentTableId}`);
                return currentTableId;
            } else { console.warn("ПРЕДУПРЕЖДЕНИЕ: getEnsuredTableId - grist.selectedTable.getTableId() вернул falsy:", id); }
        } catch (error) { console.error("ОШИБКА: getEnsuredTableId - ошибка при вызове grist.selectedTable.getTableId():", error); }
    } else { console.warn("ПРЕДУПРЕЖДЕНИЕ: getEnsuredTableId - grist.selectedTable или getTableId недоступны."); }
    if (!currentTableId && HARDCODED_TABLE_ID) {
        currentTableId = HARDCODED_TABLE_ID;
        console.warn(`ПРЕДУПРЕЖДЕНИЕ: getEnsuredTableId - используется ЗАХАРДКОЖЕННЫЙ Table ID: "${currentTableId}"`);
        return currentTableId;
    }
    if (!currentTableId) {
        console.error("ОШИБКА КРИТИЧЕСКАЯ: getEnsuredTableId - не удалось определить Table ID.");
        alert("Критическая ошибка: не удалось определить таблицу для работы.");
    }
    return currentTableId;
}

function updateOrCreateMarker(markerInstance, latLngLiteral, label, icon, isDraggable, dragEndCallback) {
    const latLng = L.latLng(latLngLiteral.lat, latLngLiteral.lng);
    if (!markerInstance) {
        markerInstance = L.marker(latLng, { icon: icon, draggable: isDraggable, title: label }).addTo(map);
        markerInstance.bindTooltip(label).openTooltip();
        console.log(`DEBUG: Маркер "${label}" создан. Иконка:`, icon.options.iconUrl);
    } else {
        markerInstance.setLatLng(latLng);
        if (markerInstance.getElement()) { markerInstance.getElement().title = label; }
        if (markerInstance.getTooltip()) { markerInstance.setTooltipContent(label); } else { markerInstance.bindTooltip(label); }
        if (!markerInstance.isTooltipOpen()) { markerInstance.openTooltip(); }
        if (!map.hasLayer(markerInstance)) { markerInstance.addTo(map); }
        if (markerInstance.options.icon !== icon) { markerInstance.setIcon(icon); }
        console.log(`DEBUG: Маркер "${label}" обновлен. Иконка:`, icon.options.iconUrl);
    }
    if (markerInstance._onDragEndListener) { markerInstance.off('dragend', markerInstance._onDragEndListener); }
    if (isDraggable && dragEndCallback) {
        markerInstance.on('dragend', dragEndCallback);
        markerInstance._onDragEndListener = dragEndCallback;
    }
    return markerInstance;
}

async function processMeetingPointData(lat, lng, tableId) {
    if (!currentRecordId || !tableId) {
        console.warn(`ПРЕДУПРЕЖДЕНИЕ: Нет Record ID (${currentRecordId}) или Table ID (${tableId}) для processMeetingPointData.`);
        if (!tableId) alert("Ошибка: Таблица для обновления данных Места Встречи не определена (processMeetingPointData).");
        return;
    }
    console.log(`DEBUG: processMeetingPointData для Места Встречи: ${lat}, ${lng} (Table: ${tableId}, Record: ${currentRecordId})`);
    let city_ru = '', county_ru = '', state_ru = '', suburb_ru = '';
    let ttTA = 'N/A', ttJer = 'N/A', ttHai = 'N/A', ttBS = 'N/A';
    const googleMapsLink = `${GOOGLE_MAPS_BASE_URL_FOR_PLACE}?ll=${lat},${lng}&q=${lat},${lng}&z=15`;
    console.log(`DEBUG: Сгенерирована ссылка Google Maps: ${googleMapsLink}`);
    const wazeLink = `https://www.waze.com/ul?ll=${lat}%2C${lng}&navigate=yes`;
    console.log(`DEBUG: Сгенерирована ссылка Waze: ${wazeLink}`);
    const nominatimUrl = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1&accept-language=en`;
    try {
        const responseNominatim = await fetch(nominatimUrl);
        if (!responseNominatim.ok) { throw new Error(`Nominatim API error ${responseNominatim.status}. URL: ${nominatimUrl}`); }
        const dataNominatim = await responseNominatim.json();
        if (dataNominatim?.address) {
            const addr = dataNominatim.address;
            [city_ru, county_ru, state_ru, suburb_ru] = await Promise.all([
                translateText(addr.city || addr.town || addr.village || addr.hamlet || '', 'ru', apiKey),
                translateText(addr.county || addr.state_district || '', 'ru', apiKey),
                translateText(addr.state || '', 'ru', apiKey),
                translateText(addr.suburb || addr.neighbourhood || addr.borough || addr.quarter || '', 'ru', apiKey)
            ]);
            console.log(`DEBUG: Nominatim address components (RU): City=${city_ru}, County=${county_ru}, State=${state_ru}, Suburb=${suburb_ru}`);
        } else {
            console.warn("Nominatim не вернул адрес для Места Встречи. Response:", dataNominatim);
            city_ru = "Адрес не найден (Nominatim)";
        }
    } catch (error) {
        console.error("ОШИБКА Nominatim/Translate (Место Встречи):", error);
        city_ru = "Ошибка геокодирования (Nominatim)";
    }
    const departureDateTime = new Date();
    let daysUntilNextFriday = (5 - departureDateTime.getDay() + 7) % 7;
    if (daysUntilNextFriday === 0 && departureDateTime.getHours() >= 7) { daysUntilNextFriday = 7; }
    departureDateTime.setDate(departureDateTime.getDate() + daysUntilNextFriday);
    departureDateTime.setHours(7, 0, 0, 0);
    console.log(`DEBUG: Расчетное время выезда для Google Directions: ${departureDateTime.toLocaleString('he-IL')}`);
    const originLocations = [ { lat: 32.0853, lng: 34.7818 }, { lat: 31.7683, lng: 35.2137 }, { lat: 32.7940, lng: 34.9896 }, { lat: 31.2530, lng: 34.7915 } ];
    try {
        const travelTimesPromises = originLocations.map(origin => getTravelTime(origin, { lat, lng }, departureDateTime));
        [ttTA, ttJer, ttHai, ttBS] = (await Promise.all(travelTimesPromises)).map(t => t || 'N/A');
        console.log(`DEBUG: Travel times: TA=${ttTA}, Jer=${ttJer}, Hai=${ttHai}, BS=${ttBS}`);
    } catch (error) { console.error("ОШИБКА Google Directions (Место Встречи, пакетный запрос):", error); }
    const updatePayload = { D: city_ru, E: county_ru, F: state_ru, H_Meeting: suburb_ru, I: ttTA, J: ttJer, K: ttHai, L: ttBS, "GoogleDrive": googleMapsLink, "Waze": wazeLink };
    Object.keys(updatePayload).forEach(key => (updatePayload[key] === undefined || updatePayload[key] === null || updatePayload[key] === '') && delete updatePayload[key]);
    if (Object.keys(updatePayload).length > 0) {
        try {
            console.log(`DEBUG: Попытка обновить Grist для Record ID ${currentRecordId} в Table ID ${tableId} данными:`, updatePayload);
            await grist.docApi.applyUserActions([['UpdateRecord', tableId, currentRecordId, updatePayload]]);
            console.log("DEBUG: Данные адреса/времени/ссылок для Места встречи успешно обновлены в Grist.");
        } catch (error) {
            console.error("ОШИБКА обновления Grist (Meeting Point Data):", error);
            alert(`Ошибка при обновлении данных в Grist: ${error.message}`);
        }
    } else { console.log("DEBUG: Нет данных для обновления в Grist (все поля пустые после обработки)."); }
}

async function handleGristRecordUpdate(record, mappings) {
    console.log("DEBUG: Grist record update received. Full Record:", JSON.stringify(record));
    console.log("DEBUG: Grist record update received. Mappings:", JSON.stringify(mappings));

    const previousRecordId = currentRecordId;
    currentRecordId = record?.id || null;
    console.log("DEBUG: Current Record ID set to:", currentRecordId);

    if (previousRecordId !== currentRecordId) {
        console.log("DEBUG: Record ID changed. Resetting meetingPointJustUpdatedByAction and lastProcessedRecordIdForMeetingPoint.");
        meetingPointJustUpdatedByAction = false;
        lastProcessedRecordIdForMeetingPoint = null;
    }

    if (!map) {
        console.warn("ПРЕДУПРЕЖДЕНИЕ: Карта не инициализирована в handleGristRecordUpdate. Выход.");
        return;
    }

    if (meetingPointMarker) { map.removeLayer(meetingPointMarker); meetingPointMarker = null; }
    if (routeStartMarker) { map.removeLayer(routeStartMarker); routeStartMarker = null; }
    if (endRouteMarker) { map.removeLayer(endRouteMarker); endRouteMarker = null; }
    if (israelHikingPolyline && map.hasLayer(israelHikingPolyline)) {
        map.removeLayer(israelHikingPolyline);
        israelHikingPolyline = null;
        console.log("DEBUG: Removed Israel Hiking Map polyline due to record update or deselection.");
    }

    if (!record || !currentRecordId) {
        console.log("DEBUG: Запись Grist не выбрана или не имеет ID. Все маркеры и полилайны очищены.");
        return;
    }

    const tableId = await getEnsuredTableId();
    if (!tableId) {
        console.error("ОШИБКА: Не удалось получить Table ID в handleGristRecordUpdate. Обработка записи прервана.");
        return;
    }

    const getVal = (fieldName) => {
        if (!mappings || !record) return undefined;
        const gristColId = mappings[fieldName];
        if (gristColId && record.hasOwnProperty(gristColId)) { return record[gristColId]; }
        if (gristColId === null) { console.log(`DEBUG: Widget field '${fieldName}' is not mapped by the user.`); }
        return undefined;
    };

    const valX = getVal("X");
    const valY = getVal("Y");
    const valHikeStartLabel = getVal("HikeStartLabel") || getVal("A");

    if (typeof valX === 'number' && typeof valY === 'number') {
        const label = valHikeStartLabel || `Старт маршрута (ID: ${currentRecordId})`;
        routeStartMarker = updateOrCreateMarker(routeStartMarker, { lat: valX, lng: valY }, label, greenIcon, true, onRouteStartMarkerDragEnd);
    } else {
        console.log("DEBUG: Координаты для 'Старта маршрута' (X,Y) отсутствуют или некорректны. X:", valX, "Y:", valY);
    }

    const valA = getVal("A");
    const valB = getVal("B");
    const valC = getVal("C");

    if (typeof valB === 'number' && typeof valC === 'number') {
        const label = valA || `Место встречи (ID: ${currentRecordId})`;
        meetingPointMarker = updateOrCreateMarker(meetingPointMarker, { lat: valB, lng: valC }, label, blueIcon, true, onMeetingPointMarkerDragEnd);
        const valD = getVal("D");
        const valI = getVal("I");
        const valGoogleDrive = getVal("GoogleDrive");
        const valWaze = getVal("Waze");
        const meetingDataIsMissingOrEmpty = !valD || String(valD).trim() === '' || String(valD).includes("Адрес не найден") || String(valD).includes("Ошибка геокода") ||
                                           !valI || String(valI).trim() === '' || String(valI).includes("N/A") || String(valI).includes("Ошибка") ||
                                           !valGoogleDrive || !valWaze;
        if (tableId && (meetingPointJustUpdatedByAction || (lastProcessedRecordIdForMeetingPoint !== currentRecordId && meetingDataIsMissingOrEmpty))) {
            console.log(`DEBUG: Обработка данных для Места Встречи. Флаг justUpdated: ${meetingPointJustUpdatedByAction}, DataMissingOrEmpty: ${meetingDataIsMissingOrEmpty}, lastProcessedRecId: ${lastProcessedRecordIdForMeetingPoint}, currentRecId: ${currentRecordId}`);
            await processMeetingPointData(valB, valC, tableId);
            lastProcessedRecordIdForMeetingPoint = currentRecordId;
        } else if (!tableId) {
            console.warn("ПРЕДУПРЕЖДЕНИЕ: Table ID не установлен, processMeetingPointData не будет вызван для Места Встречи.");
        } else {
            console.log("DEBUG: Данные для Места Встречи уже существуют или не требуют немедленной переобработки.");
        }
    } else {
        console.log("DEBUG: Координаты для 'Места встречи' (B,C) отсутствуют. B:", valB, "C:", valC);
        if (lastProcessedRecordIdForMeetingPoint === currentRecordId) { lastProcessedRecordIdForMeetingPoint = null; }
    }
    meetingPointJustUpdatedByAction = false;

    const valZ = getVal("Z");
    const valAA = getVal("AA");
    const valEndRouteLabel = getVal("EndRouteLabel");

    if (typeof valZ === 'number' && typeof valAA === 'number') {
        const label = valEndRouteLabel || `Конец маршрута (ID: ${currentRecordId})`;
        endRouteMarker = updateOrCreateMarker(endRouteMarker, { lat: valZ, lng: valAA }, label, purpleIcon, true, onEndRouteMarkerDragEnd);
    } else {
        console.log("DEBUG: Координаты для 'Конца маршрута' (Z,AA) отсутствуют. Z:", valZ, "AA:", valAA);
    }

    const rWidgetFieldName = "R";
    const rGristColumnId = mappings && mappings.hasOwnProperty(rWidgetFieldName) ? mappings[rWidgetFieldName] : null;
    let israelHikingUrl = null;

    if (rGristColumnId && record && record.hasOwnProperty(rGristColumnId)) {
        israelHikingUrl = record[rGristColumnId];
        console.log(`DEBUG (Israel Hiking): Для поля виджета '${rWidgetFieldName}', колонка Grist '${rGristColumnId}' имеет значение: "${israelHikingUrl}" (тип: ${typeof israelHikingUrl})`);
    } else {
        if (!record) { console.log(`DEBUG (Israel Hiking): Record is null. Cannot access data for widget field '${rWidgetFieldName}'.`); }
        else if (!mappings) { console.log(`DEBUG (Israel Hiking): Mappings object is null. Cannot determine Grist column for widget field '${rWidgetFieldName}'.`); }
        else if (!mappings.hasOwnProperty(rWidgetFieldName)) { console.log(`DEBUG (Israel Hiking): Widget field '${rWidgetFieldName}' (title: 'Ссылка Israel Hiking Map') not found in mappings object. Mappings:`, JSON.stringify(mappings)); }
        else if (rGristColumnId === null) { console.log(`DEBUG (Israel Hiking): Widget field '${rWidgetFieldName}' (title: 'Ссылка Israel Hiking Map') не сопоставлен пользователем ни с какой колонкой Grist в Creator Panel.`); }
        else { console.log(`DEBUG (Israel Hiking): Колонка Grist '${rGristColumnId}' (для поля виджета '${rWidgetFieldName}') не найдена как свойство в полученной записи. Ключи записи: ${Object.keys(record).join(', ')}`); }
    }

    const israelHikingUrlPattern = /https:\/\/israelhiking\.osm\.org\.il\/(?:share\/|view\/)?([a-zA-Z0-9_-]+)/;
    if (israelHikingUrl && typeof israelHikingUrl === 'string') {
        const match = israelHikingUrl.match(israelHikingUrlPattern);
        if (match && match[1]) {
            const routeId = match[1];
            console.log(`DEBUG (Israel Hiking): Извлечен ID маршрута: ${routeId} из URL "${israelHikingUrl}" (получено из колонки ${rGristColumnId || 'R (предположительно)'}).`);
            await fetchAndDisplayIsraelHikingRoute(routeId);
        } else {
            console.log(`DEBUG (Israel Hiking): Значение "${israelHikingUrl}" из колонки ${rGristColumnId || 'R (предположительно)'} не является валидной ссылкой Israel Hiking Map или ID не извлечен.`);
            if (israelHikingPolyline && map.hasLayer(israelHikingPolyline)) { map.removeLayer(israelHikingPolyline); israelHikingPolyline = null; }
        }
    } else {
        console.log(`DEBUG (Israel Hiking): Итоговое значение israelHikingUrl пустое, null или не строка (значение: "${israelHikingUrl}", тип: ${typeof israelHikingUrl}). Маршрут Israel Hiking Map не будет отображен.`);
        if (israelHikingPolyline && map.hasLayer(israelHikingPolyline)) { map.removeLayer(israelHikingPolyline); israelHikingPolyline = null; }
    }

    const activeMapElements = [meetingPointMarker, routeStartMarker, endRouteMarker, israelHikingPolyline].filter(el => el !== null && map.hasLayer(el));
    if (activeMapElements.length > 0) {
        let collectiveBounds;
        activeMapElements.forEach(element => {
            if (!element) return;
            let currentElementBounds;
            if (element instanceof L.Marker) { currentElementBounds = L.latLngBounds(element.getLatLng(), element.getLatLng()); }
            else if (element instanceof L.Polyline) {
                const latLngs = element.getLatLngs();
                if (latLngs && (Array.isArray(latLngs) ? latLngs.length > 0 : Object.keys(latLngs).length > 0)) {
                    try { currentElementBounds = element.getBounds(); }
                    catch (e) { console.warn("DEBUG: Ошибка при получении границ полилайна:", e, element); currentElementBounds = null; }
                } else { currentElementBounds = null; }
            }
            if (currentElementBounds?.isValid?.()) {
                if (!collectiveBounds) { collectiveBounds = currentElementBounds; }
                else { collectiveBounds.extend(currentElementBounds); }
            }
        });
        if (collectiveBounds?.isValid?.()) {
            const markerCount = [meetingPointMarker, routeStartMarker, endRouteMarker].filter(m => m?.getElement()).length;
            const hasVisiblePolyline = israelHikingPolyline && map.hasLayer(israelHikingPolyline) && israelHikingPolyline.getLatLngs?.()?.length > 0;
            if (markerCount === 1 && !hasVisiblePolyline && activeMapElements[0] instanceof L.Marker) { map.flyTo(activeMapElements[0].getLatLng(), MARKER_ZOOM_LEVEL); }
            else { map.fitBounds(collectiveBounds.pad(0.15)); }
        } else if (activeMapElements.length === 1 && activeMapElements[0] instanceof L.Marker) { map.flyTo(activeMapElements[0].getLatLng(), MARKER_ZOOM_LEVEL); }
        else { console.log("DEBUG: Не удалось определить границы для fitBounds или нет активных элементов с валидными границами."); }
    } else { console.log("DEBUG: Нет активных элементов на карте для адаптации вида."); }
}

async function updateGristCoordinates(markerType, lat, lng) {
    const tableId = await getEnsuredTableId();
    if (!currentRecordId || !tableId) {
        console.warn(`ПРЕДУПРЕЖДЕНИЕ: Нет Record ID (${currentRecordId}) или Table ID (${tableId}) для updateGristCoordinates (${markerType})`);
        if (!tableId) { alert("Ошибка: Таблица для обновления координат не определена."); }
        return false;
    }
    let updatePayload = {};
    switch (markerType) {
        case 'routeStart': updatePayload = { X: lat, Y: lng }; break;
        case 'meetingPoint': updatePayload = { B: lat, C: lng }; break;
        case 'endRoute': updatePayload = { Z: lat, AA: lng }; break;
        default: console.error("ОШИБКА: Неизвестный тип маркера:", markerType); return false;
    }
    try {
        await grist.docApi.applyUserActions([['UpdateRecord', tableId, currentRecordId, updatePayload]]);
        console.log(`DEBUG: Координаты Grist для "${markerType}" (Record ID: ${currentRecordId}) обновлены:`, updatePayload);
        return true;
    } catch (error) {
        console.error(`ОШИБКА обновления Grist (${markerType} coords, Record ID: ${currentRecordId}):`, error);
        alert(`Ошибка при сохранении координат "${markerType}" в Grist: ${error.message}`);
        return false;
    }
}

async function onMeetingPointMarkerDragEnd(event) {
    const position = event.target.getLatLng();
    console.log(`DEBUG: "Место встречи" (синий) перетащено: ${position.lat}, ${position.lng}`);
    meetingPointJustUpdatedByAction = true;
    await updateGristCoordinates('meetingPoint', position.lat, position.lng);
}
async function onRouteStartMarkerDragEnd(event) {
    const position = event.target.getLatLng();
    console.log(`DEBUG: "Старт маршрута" (зеленый) перетащен: ${position.lat}, ${position.lng}`);
    await updateGristCoordinates('routeStart', position.lat, position.lng);
}
async function onEndRouteMarkerDragEnd(event) {
    const position = event.target.getLatLng();
    console.log(`DEBUG: "Конец маршрута" (пурпурный) перетащен: ${position.lat}, ${position.lng}`);
    await updateGristCoordinates('endRoute', position.lat, position.lng);
}

async function handleMapClick(event) {
    if (!event.latlng) { console.warn("ПРЕДУПРЕЖДЕНИЕ: Клик по карте без координат."); return; }
    if (!currentRecordId && grist.selectedRecord?.get) {
        try {
            const selectedRec = await grist.selectedRecord.get();
            if (selectedRec?.id) {
                currentRecordId = selectedRec.id;
                console.log(`DEBUG: handleMapClick - currentRecordId получен через selectedRecord.get(): ${currentRecordId}. Вызываем handleGristRecordUpdate.`);
                await handleGristRecordUpdate(selectedRec, await grist.mappingsP); // Передаем также mappings
            }
        } catch (err) { console.warn("Не удалось получить selectedRecord.id при клике на карте:", err); }
    }
    if (!currentRecordId) { alert("Сначала выберите строку в Grist."); return; }
    const tableId = await getEnsuredTableId();
    if (!tableId) { alert("Ошибка: Таблица для обновления не определена."); return; }
    const { lat: clickedLat, lng: clickedLng } = event.latlng;
    const clickPosition = { lat: clickedLat, lng: clickedLng };

    if (!meetingPointMarker) {
        const label = `Место встречи (ID: ${currentRecordId})`;
        console.log(`DEBUG: Клик для установки "Место встречи" (синий): ${clickedLat}, ${clickedLng}.`);
        meetingPointMarker = updateOrCreateMarker(null, clickPosition, label, blueIcon, true, onMeetingPointMarkerDragEnd);
        meetingPointJustUpdatedByAction = true;
        await updateGristCoordinates('meetingPoint', clickedLat, clickedLng);
    } else if (!routeStartMarker) {
        const label = `Старт маршрута (ID: ${currentRecordId})`;
        console.log(`DEBUG: Клик для установки "Старт маршрута" (зеленый): ${clickedLat}, ${clickedLng}.`);
        routeStartMarker = updateOrCreateMarker(null, clickPosition, label, greenIcon, true, onRouteStartMarkerDragEnd);
        await updateGristCoordinates('routeStart', clickedLat, clickedLng);
    } else if (!endRouteMarker) {
        const label = `Конец маршрута (ID: ${currentRecordId})`;
        console.log(`DEBUG: Клик для установки "Конец маршрута" (пурпурный): ${clickedLat}, ${clickedLng}.`);
        endRouteMarker = updateOrCreateMarker(null, clickPosition, label, purpleIcon, true, onEndRouteMarkerDragEnd);
        await updateGristCoordinates('endRoute', clickedLat, clickedLng);
    } else {
        console.log("DEBUG: Все три основных маркера уже установлены. Клик по карте проигнорирован.");
        alert("Все три основных маркера уже установлены. Для изменения их положения, перетащите их.");
    }
}

function checkApis() {
    const leafletReady = typeof L === 'object' && L.map;
    const googleMapsReady = typeof google === 'object' && google.maps?.DirectionsService;
    const gristApiReady = typeof grist === 'object' && typeof grist.ready === 'function';
    console.log(`DEBUG: API check: Leaflet=${leafletReady}, Google Maps (Directions)=${googleMapsReady}, Grist API=${gristApiReady}`);
    if (leafletReady && googleMapsReady && gristApiReady) {
        console.log("DEBUG: Все API готовы. Инициализация карты...");
        initMap();
    } else {
        console.log("DEBUG: Одно или несколько API еще не готовы. Повторная проверка через 250 мс.");
        setTimeout(checkApis, 250);
    }
}
console.log("DEBUG: grist_map_widget_hiking.js (v9.9.30 - Улучшенное логирование latlngs): Запуск checkApis.");
checkApis();
// === КОНЕЦ СКРИПТА ===
