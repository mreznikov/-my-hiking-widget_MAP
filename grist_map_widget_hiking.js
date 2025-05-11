// === ПОЛНЫЙ КОД JAVASCRIPT ВИДЖЕТА (Версия с тремя маркерами) ===

// === ГЛОБАЛЬНЫЕ ПЕРЕМЕННЫЕ ===
let map; // Объект Leaflet Map
let startMarker = null;  // Маркер старта (красный)
let meetingMarker = null; // Маркер места встречи (синий)
let finishMarker = null; // Маркер финиша (зеленый, устанавливается кликом)

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
    if (!text || typeof text !== 'string' || !text.trim()) {
        console.log("DEBUG: translateText - пустой или невалидный текст, возвращаем пустую строку.");
        return '';
    }
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
        if (!response.ok) {
            console.error(`DEBUG: Ошибка Translation API (${response.status}) для "${text}". Тело ответа: ${responseBody}`);
            throw new Error(`Translation API error ${response.status} for text: "${text}"`);
        }
        const data = JSON.parse(responseBody);
        if (data?.data?.translations?.[0]?.translatedText) {
            const translated = data.data.translations[0].translatedText;
            console.log(`DEBUG: Перевод успешен: "${text}" -> "${translated}"`);
            const tempElem = document.createElement('textarea');
            tempElem.innerHTML = translated;
            return tempElem.value;
        } else {
            console.warn(`DEBUG: Translation API вернул неожиданную структуру для "${text}". Ответ:`, data);
            return text;
        }
    } catch (error) {
        console.error(`DEBUG: Сбой fetch или парсинга JSON при переводе для "${text}":`, error);
        return text;
    }
}

async function getTravelTime(originLatLng, destinationLatLng, departureTime) {
    let travelTimeResult = 'N/A';
    console.log(`DEBUG: Запрос времени в пути Google Directions от ${JSON.stringify(originLatLng)} до ${JSON.stringify(destinationLatLng)} на ${departureTime.toISOString()}`);
    try {
        if (typeof google === 'undefined' || !google?.maps?.DirectionsService) {
            console.error("DEBUG: Google Maps API или DirectionsService не загружен.");
            throw new Error("Google Directions Service not loaded.");
        }
        const service = new google.maps.DirectionsService();
        const directionsRequest = {
            origin: originLatLng,
            destination: destinationLatLng,
            travelMode: google.maps.TravelMode.DRIVING,
            drivingOptions: { departureTime: departureTime, trafficModel: google.maps.TrafficModel.BEST_GUESS }
        };
        const directionsResult = await new Promise((resolve, reject) => {
            service.route(directionsRequest, (response, status) => {
                if (status === google.maps.DirectionsStatus.OK) resolve(response);
                else {
                    console.error(`DEBUG: Ошибка Google Directions API: статус ${status}. Запрос:`, directionsRequest);
                    reject(new Error(`Directions status: ${status}.`));
                }
            });
        });
        console.log("DEBUG: Ответ Google Directions:", directionsResult);
        if (directionsResult.routes?.[0]?.legs?.[0]) {
            const leg = directionsResult.routes[0].legs[0];
            travelTimeResult = leg.duration_in_traffic ? leg.duration_in_traffic.text : (leg.duration ? leg.duration.text : 'Время не найдено');
            console.log(`DEBUG: Найдено время в пути: ${travelTimeResult}`);
            const warnings = directionsResult.routes[0].warnings;
            if (warnings && warnings.length > 0) {
                console.warn("DEBUG: Найдены ПРЕДУПРЕЖДЕНИЯ от Google Directions:", warnings);
                const borderKeywords = ['border', 'границ', 'checkpoint', 'crossing', 'territories', 'territory', 'таможн'];
                const hasBorderWarning = warnings.some(w => typeof w === 'string' && borderKeywords.some(k => w.toLowerCase().includes(k.toLowerCase())));
                if (hasBorderWarning) {
                    console.error("!!! ОБНАРУЖЕНО ПРЕДУПРЕЖДЕНИЕ О ВОЗМОЖНОМ ПЕРЕСЕЧЕНИИ ГРАНИЦЫ/ОСОБОЙ ЗОНЫ !!!");
                    travelTimeResult += " (ПРЕДУПРЕЖДЕНИЕ О ГРАНИЦЕ!)";
                }
            } else console.log("DEBUG: Предупреждений по маршруту нет.");
        } else {
            console.warn("DEBUG: Google Directions не вернул маршрут или участок пути. Статус:", directionsResult.status);
            travelTimeResult = `Google: ${directionsResult.status || 'Маршрут/участок не найден'}`;
        }
    } catch (error) {
        console.error("DEBUG: Сбой запроса Google Directions:", error);
        travelTimeResult = `Google: Ошибка (${error.message || 'Неизвестная ошибка'})`;
    }
    return travelTimeResult;
}

// === ОСНОВНЫЕ ФУНКЦИИ ВИДЖЕТА ===
function initMap() {
    console.log("DEBUG: Вызов initMap() для Leaflet.");
    const initialCoords = [31.771959, 35.217018];
    const initialZoom = 8;
    try {
        const mapDiv = document.getElementById('map');
        if (!mapDiv) { console.error("ОШИБКА: Контейнер для карты #map не найден в DOM!"); return; }
        map = L.map('map').setView(initialCoords, initialZoom);
        console.log("DEBUG: Объект Leaflet Map создан.");
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19,
            attribution: 'Картографические данные &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> участники'
        }).addTo(map);
        console.log("DEBUG: Слой тайлов OpenStreetMap добавлен.");
        map.on('click', handleMapClick);
        console.log("DEBUG: Обработчик клика по карте Leaflet добавлен.");
        setupGrist();
    } catch (e) { console.error("ОШИБКА: Не удалось создать объект Leaflet Map:", e); }
}

function setupGrist() {
    if (typeof grist === 'undefined' || !grist.ready) {
        console.error("ОШИБКА: Grist API не найден или не готов.");
        return;
    }
    console.log("DEBUG: Настройка взаимодействия с Grist...");
    grist.ready({
        requiredAccess: 'full',
        columns: [
            // Колонки для Места Встречи (синий маркер)
            { name: "A", type: 'Text', optional: true, title: 'Название (Место Встречи)' },
            { name: "B", type: 'Numeric', title: 'Место Встречи Широта' },
            { name: "C", type: 'Numeric', title: 'Место Встречи Долгота' },

            // Колонки для Старта (красный маркер)
            { name: "X", type: 'Numeric', optional: true, title: 'Старт Широта' },
            { name: "Y", type: 'Numeric', optional: true, title: 'Старт Долгота' },
            { name: "StartLabel", type: 'Text', optional: true, title: 'Название (Старт)' },

            // Колонки для Финиша (зеленый маркер, устанавливается кликом)
            { name: "FinishLat", type: 'Numeric', optional: true, title: 'Финиш Широта (клик)' },
            { name: "FinishLng", type: 'Numeric', optional: true, title: 'Финиш Долгота (клик)' },
            // Колонки для адреса и времени в пути ОТНОСЯТСЯ К ФИНИШУ
            { name: "D", type: 'Text', optional: true, title: 'Финиш: Город/Поселение (RU)' },
            { name: "E", type: 'Text', optional: true, title: 'Финиш: Район (RU)' },
            { name: "F", type: 'Text', optional: true, title: 'Финиш: Округ (RU)' },
            { name: "H", type: 'Text', optional: true, title: 'Финиш: Микрорайон/Деревня (RU)' },
            { name: "I", type: 'Text', optional: true, title: 'К Финишу: Время из Тель-Авива' },
            { name: "J", type: 'Text', optional: true, title: 'К Финишу: Время из Иерусалима' },
            { name: "K", type: 'Text', optional: true, title: 'К Финишу: Время из Хайфы' },
            { name: "L", type: 'Text', optional: true, title: 'К Финишу: Время из Беэр-Шевы' }
        ]
    });
    grist.onOptions(handleOptionsUpdate);
    grist.onRecord(handleGristRecordUpdate);
    console.log("DEBUG: Grist API готов, слушаем события.");
}

function handleOptionsUpdate(options, interaction) {
    console.log("DEBUG: Grist: Получено обновление опций:", options, "Interaction:", interaction);
    let foundTableId = null;
    if (options && options.tableId) foundTableId = options.tableId;
    else if (interaction && interaction.tableId) foundTableId = interaction.tableId;

    if (foundTableId) {
        currentTableId = foundTableId;
        console.log(`DEBUG: Текущий Table ID установлен: ${currentTableId}`);
    } else {
        console.warn("ПРЕДУПРЕЖДЕНИЕ: Не удалось найти tableId. Убедитесь, что виджет связан с таблицей.");
        currentTableId = null;
    }
}

function updateOrCreateMarker(markerInstance, latLngLiteral, label, icon, isDraggable, dragEndCallback) {
    const latLng = L.latLng(latLngLiteral.lat, latLngLiteral.lng);
    if (!markerInstance) {
        markerInstance = L.marker(latLng, { icon: icon, draggable: isDraggable, title: label }).addTo(map);
        markerInstance.bindTooltip(label).openTooltip();
        console.log(`DEBUG: Маркер создан. Метка: "${label}"`);
    } else {
        markerInstance.setLatLng(latLng);
        if (markerInstance.getElement()) markerInstance.getElement().title = label;
        if (markerInstance.getTooltip()) markerInstance.setTooltipContent(label);
        else markerInstance.bindTooltip(label);
        if (!markerInstance.isTooltipOpen()) markerInstance.openTooltip();
        if (!map.hasLayer(markerInstance)) markerInstance.addTo(map);
        if (markerInstance.options.icon !== icon) markerInstance.setIcon(icon); // Обновляем иконку, если необходимо
        console.log(`DEBUG: Маркер обновлен. Метка: "${label}"`);
    }

    if (markerInstance._onDragEndListener) { // Удаляем старый обработчик
        markerInstance.off('dragend', markerInstance._onDragEndListener);
    }
    if (isDraggable && dragEndCallback) { // Добавляем новый
        markerInstance.on('dragend', dragEndCallback);
        markerInstance._onDragEndListener = dragEndCallback;
    }
    return markerInstance;
}

function handleGristRecordUpdate(record, mappings) {
    console.log("DEBUG: Grist: Получено обновление записи:", record);
    if (!map) { console.warn("ПРЕДУПРЕЖДЕНИЕ: Карта не инициализирована."); return; }

    currentRecordId = record ? record.id : null;
    console.log("DEBUG: Текущий выбранный Record ID:", currentRecordId);

    // Удаляем все маркеры перед обновлением, чтобы избежать дубликатов или старых маркеров
    if (startMarker) { startMarker.remove(); startMarker = null; }
    if (meetingMarker) { meetingMarker.remove(); meetingMarker = null; }
    if (finishMarker) { finishMarker.remove(); finishMarker = null; }

    if (!record) { // Если запись не выбрана
        console.log("DEBUG: Запись Grist не выбрана, все маркеры удалены.");
        return;
    }

    // Маркер Старта (красный)
    if (typeof record.X === 'number' && typeof record.Y === 'number') {
        const startLat = record.X;
        const startLng = record.Y;
        const startLabelText = record.StartLabel || `Старт (ID: ${record.id || 'N/A'})`;
        startMarker = updateOrCreateMarker(startMarker, { lat: startLat, lng: startLng }, startLabelText, redIcon, true, onStartMarkerDragEnd);
    } else {
        console.log("DEBUG: Координаты для маркера Старта отсутствуют или невалидны.");
    }

    // Маркер Места Встречи (синий)
    if (typeof record.B === 'number' && typeof record.C === 'number') {
        const meetingLat = record.B;
        const meetingLng = record.C;
        const meetingLabel = record.A || `Место встречи (ID: ${record.id || 'N/A'})`;
        meetingMarker = updateOrCreateMarker(meetingMarker, { lat: meetingLat, lng: meetingLng }, meetingLabel, blueIcon, true, onMeetingMarkerDragEnd);
    } else {
        console.log("DEBUG: Координаты для маркера Места Встречи отсутствуют или невалидны.");
    }

    // Маркер Финиша (зеленый) - из данных Grist (если был ранее установлен кликом)
    if (typeof record.FinishLat === 'number' && typeof record.FinishLng === 'number') {
        const finishLat = record.FinishLat;
        const finishLng = record.FinishLng;
        // Метка для финиша может быть более сложной, если адрес уже есть
        const finishLabelText = record.D ? `${record.D}, ${record.F || ''}`.replace(/, $/, '') : `Финиш (ID: ${record.id || 'N/A'})`;
        finishMarker = updateOrCreateMarker(finishMarker, { lat: finishLat, lng: finishLng }, finishLabelText, greenIcon, true, onFinishMarkerDragEnd);
    } else {
        console.log("DEBUG: Координаты для маркера Финиша (из Grist) отсутствуют или невалидны.");
    }
    
    // Автоматическое масштабирование карты
    const activeMarkers = [startMarker, meetingMarker, finishMarker].filter(m => m !== null);
    if (activeMarkers.length > 1) {
        const group = new L.featureGroup(activeMarkers);
        map.fitBounds(group.getBounds().pad(0.2));
    } else if (activeMarkers.length === 1) {
        map.flyTo(activeMarkers[0].getLatLng(), MARKER_ZOOM_LEVEL);
    }
}

async function updateGristCoordinates(markerType, lat, lng) {
    if (!currentRecordId || !currentTableId) {
        console.warn(`ПРЕДУПРЕЖДЕНИЕ: Невозможно обновить Grist для ${markerType}: currentRecordId или currentTableId не установлены.`);
        return;
    }

    let updateData = {};
    if (markerType === 'start') {
        updateData = { X: lat, Y: lng };
    } else if (markerType === 'meeting') {
        updateData = { B: lat, C: lng };
    } else if (markerType === 'finish') {
        updateData = { FinishLat: lat, FinishLng: lng };
    } else {
        console.error("ОШИБКА: Неизвестный тип маркера для обновления Grist:", markerType);
        return;
    }

    try {
        console.log(`DEBUG: Обновление Grist для маркера ${markerType}. Запись: ${currentRecordId}, Таблица: ${currentTableId}, Данные:`, updateData);
        await grist.docApi.applyUserActions([['UpdateRecord', currentTableId, currentRecordId, updateData]]);
        console.log(`DEBUG: Координаты маркера ${markerType} успешно обновлены в Grist.`);
    } catch (error) {
        console.error(`ОШИБКА: Не удалось обновить координаты маркера ${markerType} в Grist:`, error);
        alert(`Ошибка обновления координат ${markerType} в Grist: ${error.message}`);
    }
}

function onStartMarkerDragEnd(event) {
    const pos = event.target.getLatLng();
    console.log(`DEBUG: Маркер Старта перетащен на: ${pos.lat}, ${pos.lng}`);
    updateGristCoordinates('start', pos.lat, pos.lng);
}

function onMeetingMarkerDragEnd(event) {
    const pos = event.target.getLatLng();
    console.log(`DEBUG: Маркер Места Встречи перетащен на: ${pos.lat}, ${pos.lng}`);
    updateGristCoordinates('meeting', pos.lat, pos.lng);
}

function onFinishMarkerDragEnd(event) {
    const pos = event.target.getLatLng();
    console.log(`DEBUG: Маркер Финиша перетащен на: ${pos.lat}, ${pos.lng}`);
    updateGristCoordinates('finish', pos.lat, pos.lng);
    // Примечание: Перетаскивание маркера финиша НЕ будет запускать геокодирование и расчет времени.
    // Это делается только при клике по карте. Если нужно, можно добавить.
}

async function handleMapClick(e) {
    if (!e.latlng) { console.warn("ПРЕДУПРЕЖДЕНИЕ: Клик по карте без координат."); return; }
    if (!currentRecordId) {
        alert("Пожалуйста, сначала выберите строку в таблице Grist для установки точки ФИНИША.");
        console.warn("ПРЕДУПРЕЖДЕНИЕ: Клик по карте, но запись Grist не выбрана. Установка финиша невозможна.");
        return;
    }

    const lat = e.latlng.lat;
    const lng = e.latlng.lng;
    const tempLabel = `Финиш (обработка)... (${lat.toFixed(4)}, ${lng.toFixed(4)})`;

    console.log(`DEBUG: Клик по карте для установки ФИНИША: ${lat}, ${lng}`);
    finishMarker = updateOrCreateMarker(finishMarker, { lat: lat, lng: lng }, tempLabel, greenIcon, true, onFinishMarkerDragEnd);

    let cityLevel_local = '', countyLevel_local = '', stateLevel_local = '', suburbLevel_local = '';
    let cityLevel_ru = '', countyLevel_ru = '', stateLevel_ru = '', suburbLevel_ru = '';
    let travelTimeTA = 'N/A', travelTimeJerusalem = 'N/A', travelTimeHaifa = 'N/A', travelTimeBeersheba = 'N/A';

    const nominatimUrl = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1&accept-language=en`;
    console.log("DEBUG: Запрос к Nominatim для финиша:", nominatimUrl);
    try {
        const response = await fetch(nominatimUrl);
        if (!response.ok) { console.error(`ОШИБКА: Nominatim API (финиш) вернул ${response.status}`); throw new Error(`Nominatim API error ${response.status}`); }
        const data = await response.json();
        console.log("DEBUG: Ответ от Nominatim (финиш):", data);
        if (data && data.address) {
            const addr = data.address;
            cityLevel_local = addr.city || addr.town || addr.village || addr.hamlet || '';
            countyLevel_local = addr.county || addr.state_district || '';
            stateLevel_local = addr.state || '';
            suburbLevel_local = addr.suburb || addr.neighbourhood || addr.borough || addr.quarter || '';
            console.log(`DEBUG: Nominatim (финиш, локальные): Город='${cityLevel_local}', Район='${countyLevel_local}', Округ='${stateLevel_local}', Микрорайон='${suburbLevel_local}'`);
            [cityLevel_ru, countyLevel_ru, stateLevel_ru, suburbLevel_ru] = await Promise.all([
                translateText(cityLevel_local, 'ru', apiKey),
                translateText(countyLevel_local, 'ru', apiKey),
                translateText(stateLevel_local, 'ru', apiKey),
                translateText(suburbLevel_local, 'ru', apiKey)
            ]);
            console.log(`DEBUG: Переведенные (финиш): Город(D)='${cityLevel_ru}', Район(E)='${countyLevel_ru}', Округ(F)='${stateLevel_ru}', Микрорайон(H)='${suburbLevel_ru}'`);
        } else { console.warn("ПРЕДУПРЕЖДЕНИЕ: Nominatim (финиш) не вернул адрес."); cityLevel_ru = "Адрес не найден"; }
    } catch (error) { console.error("ОШИБКА: Nominatim (финиш) или перевод:", error); cityLevel_ru = "Ошибка геокода"; }

    const now = new Date();
    const departureDate = new Date(now.valueOf());
    const currentDay = departureDate.getDay();
    const currentHour = departureDate.getHours();
    let daysToAdd = (5 - currentDay + 7) % 7;
    if (daysToAdd === 0 && currentHour >= 7) daysToAdd = 7;
    departureDate.setDate(departureDate.getDate() + daysToAdd);
    departureDate.setHours(7, 0, 0, 0);
    console.log(`DEBUG: Расчет времени в пути (к финишу) на: ${departureDate.toString()}`);
    const origins = [
        { name: 'Тель-Авив', coords: { lat: 32.0853, lng: 34.7818 } },
        { name: 'Иерусалим', coords: { lat: 31.7683, lng: 35.2137 } },
        { name: 'Хайфа', coords: { lat: 32.7940, lng: 34.9896 } },
        { name: 'Беэр-Шева', coords: { lat: 31.2530, lng: 34.7915 } }
    ];
    try {
        const results = await Promise.all(
            origins.map(origin => getTravelTime(origin.coords, {lat, lng}, departureDate))
        );
        travelTimeTA = results[0] || 'N/A';
        travelTimeJerusalem = results[1] || 'N/A';
        travelTimeHaifa = results[2] || 'N/A';
        travelTimeBeersheba = results[3] || 'N/A';
        console.log(`DEBUG: Получено время в пути (к финишу): ТА=${travelTimeTA}, Иерус=${travelTimeJerusalem}, Хайфа=${travelTimeHaifa}, Б-Ш=${travelTimeBeersheba}`);
    } catch (error) {
        console.error("ОШИБКА: Один или несколько запросов Google Directions (к финишу) завершились неудачей.", error);
        travelTimeTA = 'Google: Ошибка'; travelTimeJerusalem = 'Google: Ошибка'; travelTimeHaifa = 'Google: Ошибка'; travelTimeBeersheba = 'Google: Ошибка';
    }

    const finalFinishLabel = cityLevel_ru ? `${cityLevel_ru}, ${stateLevel_ru || ''}`.replace(/, $/, '') : `Финиш (${lat.toFixed(4)}, ${lng.toFixed(4)})`;
    if (finishMarker) { // Обновляем тултип маркера финиша
        finishMarker.setTooltipContent(finalFinishLabel);
        if (finishMarker.getElement()) finishMarker.getElement().title = finalFinishLabel;
    }

    // Обновление Grist для финиша
    if (currentRecordId && currentTableId) {
        const updateDataForFinish = {
            FinishLat: lat, FinishLng: lng,
            D: cityLevel_ru, E: countyLevel_ru, F: stateLevel_ru, H: suburbLevel_ru,
            I: travelTimeTA, J: travelTimeJerusalem, K: travelTimeHaifa, L: travelTimeBeersheba
        };
        Object.keys(updateDataForFinish).forEach(key => (updateDataForFinish[key] === undefined || updateDataForFinish[key] === null || updateDataForFinish[key] === '') && delete updateDataForFinish[key]);

        try {
            console.log(`DEBUG: Обновление Grist для ФИНИША. Запись: ${currentRecordId}, Таблица: ${currentTableId}, Данные:`, updateDataForFinish);
            await grist.docApi.applyUserActions([['UpdateRecord', currentTableId, currentRecordId, updateDataForFinish]]);
            console.log("DEBUG: Данные финиша успешно обновлены в Grist.");
        } catch (error) {
            console.error("ОШИБКА: Не удалось обновить данные финиша в Grist:", error);
            alert(`Ошибка обновления данных финиша в Grist: ${error.message}`);
        }
    }
}

function checkApis() {
    console.log("DEBUG: === ВХОД в checkApis ===");
    const leafletReady = typeof L === 'object' && L !== null && typeof L.map === 'function';
    const googleReady = typeof google === 'object' && typeof google.maps === 'object' && typeof google.maps.DirectionsService === 'function';
    console.log(`DEBUG: Статус готовности: Leaflet = ${leafletReady}, Google Maps (с DirectionsService) = ${googleReady}`);

    if (leafletReady && googleReady) {
        console.log("DEBUG: Оба API готовы.");
        initMap();
    } else {
        console.warn("ПРЕДУПРЕЖДЕНИЕ: Проверка API НЕ ПРОЙДЕНА. Повторная попытка через 250 мс...");
        setTimeout(checkApis, 250);
    }
    console.log("DEBUG: === ВЫХОД из checkApis ===");
}

console.log("DEBUG: Вызов checkApis для запуска процесса инициализации виджета.");
checkApis();
console.log("DEBUG: Скрипт grist_map_widget_hiking.js выполнен, процесс инициализации запущен.");
// === КОНЕЦ СКРИПТА ===
