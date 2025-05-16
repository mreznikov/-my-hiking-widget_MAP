// === ПОЛНЫЙ КОД JAVASCRIPT ВИДЖЕТА (Версия: v9.9.28 - с интеграцией Israel Hiking Map) ===

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
// Предполагается, что файлы иконок находятся в том же каталоге, что и index.html
const blueIconUrl = 'Parking-32.png';
const greenIconUrl = 'trekking-32.png';
const purpleIconUrl = 'Finish-Flag-32.png';

// Общие опции для всех иконок
const commonIconOptions = {
    iconSize: [32, 32],     // Размер иконки
    iconAnchor: [16, 32],   // Точка "якоря" иконки (где она будет указывать на карту)
    popupAnchor: [0, -32],  // Смещение всплывающего окна относительно якоря
    tooltipAnchor: [16, -24] // Смещение всплывающей подсказки
};

// Создание объектов иконок Leaflet
const blueIcon = L.icon({ ...commonIconOptions, iconUrl: blueIconUrl });
const greenIcon = L.icon({ ...commonIconOptions, iconUrl: greenIconUrl });
const purpleIcon = L.icon({ ...commonIconOptions, iconUrl: purpleIconUrl });

// === ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ===

/**
 * Переводит текст на указанный язык с помощью Google Translation API.
 * @param {string} text - Текст для перевода.
 * @param {string} targetLang - Целевой язык (например, 'ru').
 * @param {string} apiKey - API ключ Google.
 * @returns {Promise<string>} - Переведенный текст или оригинальный текст в случае ошибки/пустого ответа.
 */
async function translateText(text, targetLang, apiKey) {
    if (!text || typeof text !== 'string' || !text.trim()) {
        console.warn("DEBUG: translateText: Пустой текст для перевода.");
        return ''; // Возвращаем пустую строку, если текст пустой
    }
    const url = `https://translation.googleapis.com/language/translate/v2?key=${apiKey}`;
    console.log(`DEBUG: translateText: "${text}" to ${targetLang}`);
    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify({ q: text, target: targetLang })
        });
        const responseBodyText = await response.text(); // Сначала получаем текстовый ответ для отладки
        console.log(`DEBUG: translateText status for "${text}": ${response.status}, response: ${responseBodyText}`);

        if (!response.ok) {
            throw new Error(`Translation API error ${response.status}. Response: ${responseBodyText}`);
        }

        const data = JSON.parse(responseBodyText); // Парсим JSON после проверки статуса
        if (data?.data?.translations?.[0]?.translatedText) {
            const translated = data.data.translations[0].translatedText;
            console.log(`DEBUG: translateText success: "${text}" -> "${translated}"`);
            // Декодирование HTML сущностей (например, ' -> ')
            const textarea = document.createElement('textarea');
            textarea.innerHTML = translated;
            return textarea.value;
        } else {
            console.warn(`DEBUG: translateText no translation found for "${text}" in response data:`, data);
            return text; // Возвращаем оригинал, если перевод не найден
        }
    } catch (error) {
        console.error(`DEBUG: translateText failed for "${text}":`, error);
        return text; // Возвращаем оригинал в случае ошибки
    }
}

/**
 * Получает примерное время в пути между двумя точками с помощью Google Directions API.
 * @param {object} originLatLng - Координаты начальной точки {lat, lng}.
 * @param {object} destinationLatLng - Координаты конечной точки {lat, lng}.
 * @param {Date} departureTime - Время отправления.
 * @returns {Promise<string>} - Строка с временем в пути или сообщение об ошибке/отсутствии данных.
 */
async function getTravelTime(originLatLng, destinationLatLng, departureTime) {
    let travelTimeResult = 'N/A'; // Значение по умолчанию
    console.log(`DEBUG: getTravelTime from ${JSON.stringify(originLatLng)} to ${JSON.stringify(destinationLatLng)} at ${departureTime.toISOString()}`);
    try {
        if (typeof google === 'undefined' || !google?.maps?.DirectionsService) {
            throw new Error("Google Directions Service not loaded.");
        }
        const directionsService = new google.maps.DirectionsService();
        const request = {
            origin: originLatLng,
            destination: destinationLatLng,
            travelMode: google.maps.TravelMode.DRIVING,
            drivingOptions: {
                departureTime: departureTime,
                trafficModel: google.maps.TrafficModel.BEST_GUESS // Учитывать текущий и прогнозируемый трафик
            }
        };

        // Google Directions API возвращает Promise через callback, оборачиваем в Promise
        const result = await new Promise((resolve, reject) => {
            directionsService.route(request, (response, status) => {
                if (status === google.maps.DirectionsStatus.OK) {
                    resolve(response);
                } else {
                    reject(new Error(`Directions API status: ${status}. Request: ${JSON.stringify(request)}`));
                }
            });
        });

        if (result.routes && result.routes.length > 0 && result.routes[0].legs && result.routes[0].legs.length > 0) {
            const leg = result.routes[0].legs[0];
            travelTimeResult = leg.duration_in_traffic?.text || leg.duration?.text || 'Время не найдено';

            // Проверка на предупреждения о пересечении границ (пример)
            if (result.routes[0].warnings && result.routes[0].warnings.some(w =>
                typeof w === 'string' && ['border', 'границ', 'checkpoint', 'crossing', 'territories', 'territory', 'таможн'].some(keyword => w.toLowerCase().includes(keyword.toLowerCase()))
            )) {
                travelTimeResult += " (ПРЕДУПРЕЖДЕНИЕ О ГРАНИЦЕ!)";
            }
        } else {
            // Если маршрут не найден, но статус OK (маловероятно, но возможно)
            travelTimeResult = `Google: Маршрут не найден (статус OK)`;
        }
    } catch (error) {
        travelTimeResult = `Google: Ошибка (${error.message || 'Неизвестная ошибка API'})`;
        console.error("DEBUG: getTravelTime error:", error);
    }
    console.log(`DEBUG: getTravelTime result: ${travelTimeResult}`);
    return travelTimeResult;
}

/**
 * Загружает и отображает маршрут с Israel Hiking Map API.
 * @param {string} routeId - ID маршрута из URL (например, 'fUgoeYIH3v').
 */
async function fetchAndDisplayIsraelHikingRoute(routeId) {
    if (!routeId) {
        console.warn("DEBUG (Israel Hiking): routeId не предоставлен. Очистка полилайна, если существует.");
        if (israelHikingPolyline && map.hasLayer(israelHikingPolyline)) {
            map.removeLayer(israelHikingPolyline);
        }
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
        // Для более детального логирования можно вывести сами данные, но это может быть объемно:
        // console.log(`DEBUG (Israel Hiking): Полученные данные (первые 500 символов): ${JSON.stringify(data).substring(0, 500)}`);


        // Удаляем предыдущий полилайн, если он есть, перед добавлением нового или если новый пуст
        if (israelHikingPolyline && map.hasLayer(israelHikingPolyline)) {
            console.log(`DEBUG (Israel Hiking): Удаление существующего полилайна Israel Hiking Map.`);
            map.removeLayer(israelHikingPolyline);
        }
        israelHikingPolyline = null; // Сбрасываем в любом случае

        if (data && data.latlngs && Array.isArray(data.latlngs) && data.latlngs.length > 0) {
            console.log(`DEBUG (Israel Hiking): Найдено ${data.latlngs.length} точек маршрута в ответе API.`);
            const latLngsArray = data.latlngs.map(point => [point.lat, point.lng]);
            console.log(`DEBUG (Israel Hiking): Точки маршрута преобразованы в формат Leaflet.`);
            // Логирование первых нескольких точек для проверки
            if (latLngsArray.length > 0) {
                console.log(`DEBUG (Israel Hiking): Пример первых 3 точек: ${JSON.stringify(latLngsArray.slice(0,3))}`);
            }


            israelHikingPolyline = L.polyline(latLngsArray, {
                color: 'red',    // Цвет линии
                weight: 3,       // Толщина линии
                opacity: 0.8     // Прозрачность линии
            });
            console.log(`DEBUG (Israel Hiking): Объект L.polyline создан.`);

            israelHikingPolyline.addTo(map);
            console.log(`DEBUG (Israel Hiking): Полилайн маршрута Israel Hiking Map добавлен на карту.`);
        } else {
            console.warn(`DEBUG (Israel Hiking): В ответе API не найдены точки маршрута (latlngs) или массив пуст для ID: ${routeId}. Ответ:`, data);
            // Полилайн уже сброшен выше
        }
    } catch (error) {
        console.error(`DEBUG (Israel Hiking): Ошибка при загрузке или отображении маршрута Israel Hiking Map для ID: ${routeId}`, error);
        // Убедимся, что полилайн удален в случае ошибки
        if (israelHikingPolyline && map.hasLayer(israelHikingPolyline)) {
            map.removeLayer(israelHikingPolyline);
        }
        israelHikingPolyline = null;
    }
    console.log(`DEBUG (Israel Hiking): Завершение fetchAndDisplayIsraelHikingRoute для ID: ${routeId}`);
}


// === ОСНОВНЫЕ ФУНКЦИИ ===

/**
 * Инициализирует карту Leaflet.
 */
function initMap() {
    console.log("DEBUG: initMap()");
    try {
        map = L.map('map').setView([31.771959, 35.217018], 8); // Начальный центр карты (Иерусалим) и масштаб

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19,
            attribution: '© <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        }).addTo(map);

        map.on('click', handleMapClick); // Обработчик кликов по карте
        setupGrist(); // Настройка интеграции с Grist
    } catch (e) {
        console.error("ОШИБКА initMap:", e);
        // Можно добавить отображение ошибки пользователю, если карта не инициализируется
        document.getElementById('map').innerHTML = '<p style="color:red; text-align:center; padding-top: 20px;">Ошибка инициализации карты. Подробности в консоли.</p>';
    }
}

/**
 * Настраивает интеграцию с Grist API.
 */
function setupGrist() {
    if (typeof grist === 'undefined' || !grist.ready) {
        console.error("ОШИБКА: Grist API не готов. Повторная попытка через 500мс.");
        // Можно добавить более умную логику ожидания или сообщение пользователю
        setTimeout(setupGrist, 500);
        return;
    }
    console.log("DEBUG: setupGrist()");

    // Определение колонок, с которыми будет работать виджет
    grist.ready({
        requiredAccess: 'full', // Запрашиваем полный доступ к документу
        columns: [
            // Колонки для "Старта маршрута"
            { name: "X", type: 'Numeric', optional: true, title: 'Старт маршрута Широта' },
            { name: "Y", type: 'Numeric', optional: true, title: 'Старт маршрута Долгота' },
            { name: "HikeStartLabel", type: 'Text', optional: true, title: 'Название Старта маршрута' },

            // Колонки для "Места встречи"
            { name: "A", type: 'Text', optional: true, title: 'Название Места встречи' }, // Название/метка
            { name: "B", type: 'Numeric', title: 'Место встречи Широта' }, // Обязательное поле для координат
            { name: "C", type: 'Numeric', title: 'Место встречи Долгота' }, // Обязательное поле для координат
            { name: "GoogleDrive", type: 'Text', optional: true, title: 'Место встреч. Google Карта ссылка' }, // Ссылка на Google Maps
            { name: "Waze", type: 'Text', optional: true, title: 'Место встреч. Waze ссылка' }, // Ссылка на Waze

            // Колонки для адресной информации "Места встречи" (заполняются автоматически)
            { name: "D", type: 'Text', optional: true, title: 'Адрес Места встречи: Город' },
            { name: "E", type: 'Text', optional: true, title: 'Адрес Места встречи: Район' }, // County/State District
            { name: "F", type: 'Text', optional: true, title: 'Адрес Места встречи: Округ' }, // State
            { name: "H_Meeting", type: 'Text', optional: true, title: 'Адрес Места встречи: Микрорайон/Окрестность' }, // Suburb/Neighbourhood

            // Колонки для времени в пути до "Места встречи" (заполняются автоматически)
            { name: "I", type: 'Text', optional: true, title: 'К Месту встречи: Время из Тель-Авива' },
            { name: "J", type: 'Text', optional: true, title: 'К Месту встречи: Время из Иерусалима' },
            { name: "K", type: 'Text', optional: true, title: 'К Месту встречи: Время из Хайфы' },
            { name: "L", type: 'Text', optional: true, title: 'К Месту встречи: Время из Беэр-Шевы' },

            // Колонки для "Конца маршрута"
            { name: "Z", type: 'Numeric', optional: true, title: 'Конец маршрута Широта' },
            { name: "AA", type: 'Numeric', optional: true, title: 'Конец маршрута Долгота' },
            { name: "EndRouteLabel", type: 'Text', optional: true, title: 'Название Конца маршрута' },

            // Колонка для ссылки на Israel Hiking Map
            { name: "R", type: 'Text', optional: true, title: 'Ссылка Israel Hiking Map' }
        ]
        // tableId: "ИмяТаблицы" // Можно указать конкретную таблицу, если нужно
    });

    // Подписка на изменение опций виджета (например, если пользователь привяжет виджет к другой таблице)
    grist.onOptions(handleOptionsUpdate);
    // Подписка на изменение выбранной записи в Grist
    grist.onRecord(handleGristRecordUpdate); // Эта функция будет вызываться асинхронно
    console.log("DEBUG: Grist API готов и подписки установлены.");
}

/**
 * Обрабатывает обновление опций виджета Grist (например, смена таблицы).
 * @param {object|null} options - Новые опции.
 * @param {object|null} interaction - Данные о взаимодействии, вызвавшем обновление.
 */
function handleOptionsUpdate(options, interaction) {
    console.log("DEBUG: Grist options update:", options, "Interaction:", interaction);
    // Обновляем ID текущей таблицы, если он предоставлен
    currentTableId = (options?.tableId) || (interaction?.tableId) || currentTableId || null;
    if (currentTableId) {
        console.log(`DEBUG: Table ID установлен/обновлен через onOptions: ${currentTableId}`);
    } else {
        console.warn("ПРЕДУПРЕЖДЕНИЕ: Table ID не был предоставлен через grist.onOptions. Будет использован fallback (включая hardcoded, если currentTableId был null).");
    }
    // При смене таблицы, возможно, стоит перезапросить текущую запись, если она была выбрана
    // grist.selectedRecord.get().then(handleGristRecordUpdate); // Пример
}

/**
 * Гарантирует получение ID текущей таблицы Grist.
 * Использует кэшированное значение, запрашивает у Grist API или использует HARDCODED_TABLE_ID.
 * @returns {Promise<string|null>} - ID таблицы или null, если не удалось определить.
 */
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
                console.warn("ПРЕДУПРЕЖДЕНИЕ: getEnsuredTableId - grist.selectedTable.getTableId() вернул falsy (пустое значение):", id);
            }
        } catch (error) {
            console.error("ОШИБКА: getEnsuredTableId - ошибка при вызове grist.selectedTable.getTableId():", error);
        }
    } else {
        console.warn("ПРЕДУПРЕЖДЕНИЕ: getEnsuredTableId - grist.selectedTable или getTableId недоступны.");
    }

    // Если не удалось получить ID автоматически, используем запасной вариант
    if (!currentTableId && HARDCODED_TABLE_ID) {
        currentTableId = HARDCODED_TABLE_ID;
        console.warn(`ПРЕДУПРЕЖДЕНИЕ: getEnsuredTableId - Table ID не удалось получить автоматически. Используется ЗАХАРДКОЖЕННЫЙ Table ID: "${currentTableId}"`);
        return currentTableId;
    }

    if (!currentTableId) {
        console.error("ОШИБКА КРИТИЧЕСКАЯ: getEnsuredTableId - не удалось определить Table ID никаким способом.");
        alert("Критическая ошибка: не удалось определить таблицу для работы. Проверьте конфигурацию виджета.");
    }
    return currentTableId; // Может быть null, если все попытки провалились
}

/**
 * Создает новый маркер на карте или обновляет существующий.
 * @param {L.Marker|null} markerInstance - Существующий экземпляр маркера (или null).
 * @param {object} latLngLiteral - Координаты {lat, lng}.
 * @param {string} label - Текст для всплывающей подсказки и заголовка маркера.
 * @param {L.Icon} icon - Иконка для маркера.
 * @param {boolean} isDraggable - Можно ли перетаскивать маркер.
 * @param {function|null} dragEndCallback - Функция обратного вызова при завершении перетаскивания.
 * @returns {L.Marker} - Созданный или обновленный маркер.
 */
function updateOrCreateMarker(markerInstance, latLngLiteral, label, icon, isDraggable, dragEndCallback) {
    const latLng = L.latLng(latLngLiteral.lat, latLngLiteral.lng); // Преобразуем в объект Leaflet LatLng

    if (!markerInstance) { // Создаем новый маркер
        markerInstance = L.marker(latLng, {
            icon: icon,
            draggable: isDraggable,
            title: label // title для нативного title HTML элемента (появляется при наведении)
        }).addTo(map);
        markerInstance.bindTooltip(label).openTooltip(); // Всплывающая подсказка Leaflet
        console.log(`DEBUG: Маркер "${label}" создан. Иконка:`, icon.options.iconUrl);
    } else { // Обновляем существующий маркер
        markerInstance.setLatLng(latLng);
        if (markerInstance.getElement()) { // Обновляем нативный title, если элемент существует
            markerInstance.getElement().title = label;
        }
        // Обновляем или создаем всплывающую подсказку Leaflet
        if (markerInstance.getTooltip()) {
            markerInstance.setTooltipContent(label);
        } else {
            markerInstance.bindTooltip(label);
        }
        if (!markerInstance.isTooltipOpen()) { // Открываем, если закрыта
            markerInstance.openTooltip();
        }
        if (!map.hasLayer(markerInstance)) { // Добавляем на карту, если был удален
            markerInstance.addTo(map);
        }
        if (markerInstance.options.icon !== icon) { // Обновляем иконку, если изменилась
            markerInstance.setIcon(icon);
        }
        console.log(`DEBUG: Маркер "${label}" обновлен. Иконка:`, icon.options.iconUrl);
    }

    // Удаляем старый обработчик dragend, если он был, чтобы избежать дублирования
    if (markerInstance._onDragEndListener) {
        markerInstance.off('dragend', markerInstance._onDragEndListener);
    }
    // Добавляем новый обработчик dragend, если маркер перетаскиваемый и есть callback
    if (isDraggable && dragEndCallback) {
        markerInstance.on('dragend', dragEndCallback);
        markerInstance._onDragEndListener = dragEndCallback; // Сохраняем ссылку на слушатель для возможного удаления
    }
    return markerInstance;
}

/**
 * Обрабатывает данные для "Места встречи": получает адрес, ссылки, время в пути и обновляет Grist.
 * @param {number} lat - Широта.
 * @param {number} lng - Долгота.
 * @param {string} tableId - ID таблицы Grist.
 */
async function processMeetingPointData(lat, lng, tableId) {
    if (!currentRecordId || !tableId) {
        console.warn(`ПРЕДУПРЕЖДЕНИЕ: Нет Record ID (${currentRecordId}) или Table ID (${tableId}) для processMeetingPointData.`);
        if (!tableId) alert("Ошибка: Таблица для обновления данных Места Встречи не определена (processMeetingPointData).");
        return;
    }

    console.log(`DEBUG: processMeetingPointData для Места Встречи: ${lat}, ${lng} (Table: ${tableId}, Record: ${currentRecordId})`);

    let city_ru = '', county_ru = '', state_ru = '', suburb_ru = '';
    let ttTA = 'N/A', ttJer = 'N/A', ttHai = 'N/A', ttBS = 'N/A'; // Время в пути из Тель-Авива, Иерусалима, Хайфы, Беэр-Шевы

    // 1. Генерация ссылок на карты
    const googleMapsLink = `${GOOGLE_MAPS_BASE_URL_FOR_PLACE}?ll=${lat},${lng}&q=${lat},${lng}&z=15`; // Добавлен параметр q для метки и z для масштаба
    console.log(`DEBUG: Сгенерирована ссылка Google Maps: ${googleMapsLink}`);

    const wazeLink = `https://www.waze.com/ul?ll=${lat}%2C${lng}&navigate=yes`;
    console.log(`DEBUG: Сгенерирована ссылка Waze: ${wazeLink}`);

    // 2. Получение адреса через Nominatim (OSM) и перевод на русский
    const nominatimUrl = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1&accept-language=en`;
    try {
        const responseNominatim = await fetch(nominatimUrl);
        if (!responseNominatim.ok) {
            throw new Error(`Nominatim API error ${responseNominatim.status}. URL: ${nominatimUrl}`);
        }
        const dataNominatim = await responseNominatim.json();
        if (dataNominatim?.address) {
            const addr = dataNominatim.address;
            // Параллельный перевод всех компонентов адреса
            [city_ru, county_ru, state_ru, suburb_ru] = await Promise.all([
                translateText(addr.city || addr.town || addr.village || addr.hamlet || '', 'ru', apiKey),
                translateText(addr.county || addr.state_district || '', 'ru', apiKey), // Район области / Административный округ
                translateText(addr.state || '', 'ru', apiKey), // Область / Штат
                translateText(addr.suburb || addr.neighbourhood || addr.borough || addr.quarter || '', 'ru', apiKey) // Микрорайон
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

    // 3. Расчет времени в пути (например, на следующую пятницу в 7 утра)
    const departureDateTime = new Date();
    let daysUntilNextFriday = (5 - departureDateTime.getDay() + 7) % 7; // 5 - это пятница (0-воскресенье)
    // Если сегодня пятница и время уже 7 утра или позже, то берем следующую пятницу
    if (daysUntilNextFriday === 0 && departureDateTime.getHours() >= 7) {
        daysUntilNextFriday = 7;
    }
    departureDateTime.setDate(departureDateTime.getDate() + daysUntilNextFriday);
    departureDateTime.setHours(7, 0, 0, 0); // Устанавливаем время на 7:00:00.000
    console.log(`DEBUG: Расчетное время выезда для Google Directions: ${departureDateTime.toLocaleString('he-IL')}`);


    // Координаты городов для расчета времени в пути (Тель-Авив, Иерусалим, Хайфа, Беэр-Шева)
    const originLocations = [
        { lat: 32.0853, lng: 34.7818 }, // Tel Aviv
        { lat: 31.7683, lng: 35.2137 }, // Jerusalem
        { lat: 32.7940, lng: 34.9896 }, // Haifa
        { lat: 31.2530, lng: 34.7915 }  // Beersheba
    ];
    try {
        const travelTimesPromises = originLocations.map(origin =>
            getTravelTime(origin, { lat, lng }, departureDateTime)
        );
        const travelTimesResults = await Promise.all(travelTimesPromises);
        [ttTA, ttJer, ttHai, ttBS] = travelTimesResults.map(t => t || 'N/A'); // Если что-то пошло не так, будет N/A
        console.log(`DEBUG: Travel times: TA=${ttTA}, Jer=${ttJer}, Hai=${ttHai}, BS=${ttBS}`);
    } catch (error) {
        console.error("ОШИБКА Google Directions (Место Встречи, пакетный запрос):", error);
        // Оставляем значения по умолчанию 'N/A'
    }

    // 4. Обновление записи в Grist
    const updatePayload = {
        D: city_ru, E: county_ru, F: state_ru, H_Meeting: suburb_ru,
        I: ttTA, J: ttJer, K: ttHai, L: ttBS,
        "GoogleDrive": googleMapsLink, // Убедитесь, что имя колонки в Grist именно "GoogleDrive"
        "Waze": wazeLink               // И "Waze"
    };
    // Удаляем пустые значения из объекта, чтобы не перезаписывать существующие данные пустыми строками
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
    } else {
        console.log("DEBUG: Нет данных для обновления в Grist (все поля пустые после обработки).");
    }
}

/**
 * Обрабатывает обновление выбранной записи в Grist.
 * @param {object|null} record - Данные выбранной записи или null, если запись не выбрана.
 * @param {object|null} mappings - Информация о маппинге колонок (если используется).
 */
async function handleGristRecordUpdate(record, mappings) {
    console.log("DEBUG: Grist record update received. Record:", record, "Mappings:", mappings);
    const previousRecordId = currentRecordId;
    currentRecordId = record?.id || null; // Обновляем ID текущей записи
    console.log("DEBUG: Current Record ID set to:", currentRecordId);

    // Если ID записи изменился, сбрасываем флаги, связанные с обработкой данных места встречи
    if (previousRecordId !== currentRecordId) {
        console.log("DEBUG: Record ID changed. Resetting meetingPointJustUpdatedByAction and lastProcessedRecordIdForMeetingPoint.");
        meetingPointJustUpdatedByAction = false;
        lastProcessedRecordIdForMeetingPoint = null;
    }

    if (!map) {
        console.warn("ПРЕДУПРЕЖДЕНИЕ: Карта не инициализирована в handleGristRecordUpdate. Выход.");
        return;
    }

    // Очищаем все предыдущие маркеры и полилайн при каждом обновлении записи
    // Это гарантирует, что на карте не останутся элементы от предыдущей записи
    if (meetingPointMarker) { map.removeLayer(meetingPointMarker); meetingPointMarker = null; }
    if (routeStartMarker) { map.removeLayer(routeStartMarker); routeStartMarker = null; }
    if (endRouteMarker) { map.removeLayer(endRouteMarker); endRouteMarker = null; }
    if (israelHikingPolyline && map.hasLayer(israelHikingPolyline)) { // Проверяем, что слой на карте перед удалением
        map.removeLayer(israelHikingPolyline);
        israelHikingPolyline = null;
        console.log("DEBUG: Removed Israel Hiking Map polyline due to record update or deselection.");
    }


    if (!record || !currentRecordId) { // Если запись не выбрана (record is null или нет id)
        console.log("DEBUG: Запись Grist не выбрана или не имеет ID. Все маркеры и полилайны очищены. Карта остается без изменений.");
        // Флаги уже сброшены выше, если ID изменился. Полилайн также очищен.
        return;
    }

    const tableId = await getEnsuredTableId(); // Получаем ID таблицы
    if (!tableId) {
        console.error("ОШИБКА: Не удалось получить Table ID в handleGristRecordUpdate. Обработка записи прервана.");
        return; // Не можем продолжать без ID таблицы
    }

    // --- Обработка маркера "Старт маршрута" (зеленый, из колонок X, Y) ---
    if (typeof record.X === 'number' && typeof record.Y === 'number') {
        const label = record.HikeStartLabel || `Старт маршрута (ID: ${currentRecordId})`;
        routeStartMarker = updateOrCreateMarker(routeStartMarker, { lat: record.X, lng: record.Y }, label, greenIcon, true, onRouteStartMarkerDragEnd);
    } else {
        console.log("DEBUG: Координаты для 'Старта маршрута' (X,Y) отсутствуют или некорректны в записи:", record);
    }

    // --- Обработка маркера "Место встречи" (синий, из колонок B, C) ---
    if (typeof record.B === 'number' && typeof record.C === 'number') {
        const label = record.A || `Место встречи (ID: ${currentRecordId})`;
        meetingPointMarker = updateOrCreateMarker(meetingPointMarker, { lat: record.B, lng: record.C }, label, blueIcon, true, onMeetingPointMarkerDragEnd);

        // Проверяем, нужно ли обновлять данные для места встречи (адрес, время и т.д.)
        // Условия:
        // 1. Маркер был только что обновлен пользователем (meetingPointJustUpdatedByAction = true)
        // ИЛИ
        // 2. Это новая запись (lastProcessedRecordIdForMeetingPoint !== currentRecordId) И данные отсутствуют/неполные
        const meetingDataFieldsToCheck = ['D', 'I', 'GoogleDrive', 'Waze']; // Ключевые поля для проверки
        const meetingDataIsMissingOrEmpty = meetingDataFieldsToCheck.some(field =>
            !record[field] || String(record[field]).trim() === '' ||
            String(record[field]).includes("Адрес не найден") ||
            String(record[field]).includes("Ошибка геокода") ||
            String(record[field]).includes("N/A") ||
            String(record[field]).includes("Ошибка")
        );

        if (tableId && (meetingPointJustUpdatedByAction || (lastProcessedRecordIdForMeetingPoint !== currentRecordId && meetingDataIsMissingOrEmpty))) {
            console.log(`DEBUG: Обработка данных для Места Встречи. Флаг justUpdated: ${meetingPointJustUpdatedByAction}, DataMissingOrEmpty: ${meetingDataIsMissingOrEmpty}, lastProcessedRecId: ${lastProcessedRecordIdForMeetingPoint}, currentRecId: ${currentRecordId}`);
            await processMeetingPointData(record.B, record.C, tableId); // Асинхронно обрабатываем данные
            lastProcessedRecordIdForMeetingPoint = currentRecordId; // Помечаем, что для этой записи данные обработаны
        } else if (!tableId) {
            console.warn("ПРЕДУПРЕЖДЕНИЕ: Table ID не установлен, processMeetingPointData не будет вызван для Места Встречи.");
        } else {
            console.log("DEBUG: Данные для Места Встречи уже существуют, не требуют немедленной переобработки, или это не первое открытие записи без действия пользователя. Пропуск processMeetingPointData.");
        }
    } else {
        console.log("DEBUG: Координаты для 'Места встречи' (B,C) отсутствуют или некорректны в записи:", record);
        // Если координаты места встречи были удалены из Grist, и это та же запись,
        // сбрасываем lastProcessedRecordIdForMeetingPoint, чтобы при следующем появлении координат данные были пересчитаны.
        if (lastProcessedRecordIdForMeetingPoint === currentRecordId) {
             lastProcessedRecordIdForMeetingPoint = null;
        }
    }
    meetingPointJustUpdatedByAction = false; // Сбрасываем флаг после обработки

    // --- Обработка маркера "Конец маршрута" (пурпурный, из колонок Z, AA) ---
    if (typeof record.Z === 'number' && typeof record.AA === 'number') {
        const label = record.EndRouteLabel || `Конец маршрута (ID: ${currentRecordId})`;
        endRouteMarker = updateOrCreateMarker(endRouteMarker, { lat: record.Z, lng: record.AA }, label, purpleIcon, true, onEndRouteMarkerDragEnd);
    } else {
        console.log("DEBUG: Координаты для 'Конца маршрута' (Z,AA) отсутствуют или некорректны в записи:", record);
    }

    // --- Интеграция Israel Hiking Map (Колонка R) ---
    const israelHikingUrl = record.R; // Получаем значение из колонки R
    const israelHikingUrlPattern = /https:\/\/israelhiking\.osm\.org\.il\/(?:share\/|view\/)?([a-zA-Z0-9_-]+)/; // Паттерн для извлечения ID

    // Полилайн уже должен быть очищен в начале функции. Здесь мы только создаем новый, если нужно.
    if (israelHikingUrl && typeof israelHikingUrl === 'string') {
        const match = israelHikingUrl.match(israelHikingUrlPattern);
        if (match && match[1]) {
            const routeId = match[1];
            console.log(`DEBUG: Found Israel Hiking Map URL in column R. Extracted ID: ${routeId}`);
            await fetchAndDisplayIsraelHikingRoute(routeId); // Асинхронно загружаем и отображаем маршрут
        } else {
            console.log("DEBUG: Column R does not contain a valid Israel Hiking Map share/view URL or ID couldn't be extracted. Current value:", israelHikingUrl);
            // Убедимся, что полилайн точно удален, если URL невалиден (хотя очистка в начале должна это покрывать)
            if (israelHikingPolyline && map.hasLayer(israelHikingPolyline)) { map.removeLayer(israelHikingPolyline); israelHikingPolyline = null; }
        }
    } else {
        console.log("DEBUG: Column R is empty or not a string. No Israel Hiking Map route to display.");
        // Убедимся, что полилайн точно удален, если значение в R пустое (аналогично)
        if (israelHikingPolyline && map.hasLayer(israelHikingPolyline)) { map.removeLayer(israelHikingPolyline); israelHikingPolyline = null; }
    }
    // --- Конец интеграции Israel Hiking Map ---


    // --- Адаптация вида карты под активные элементы (маркеры и полилайн) ---
    const activeMapElements = [meetingPointMarker, routeStartMarker, endRouteMarker, israelHikingPolyline].filter(el => el !== null && map.hasLayer(el));

    if (activeMapElements.length > 0) {
        let collectiveBounds;

        activeMapElements.forEach(element => {
            if (!element) return; // Дополнительная проверка
            let currentElementBounds;
            if (element instanceof L.Marker) {
                currentElementBounds = L.latLngBounds(element.getLatLng(), element.getLatLng());
            } else if (element instanceof L.Polyline) {
                // Проверяем, есть ли у полилайна точки, прежде чем брать getBounds()
                const latLngs = element.getLatLngs();
                if (latLngs && (Array.isArray(latLngs) ? latLngs.length > 0 : Object.keys(latLngs).length > 0) ) { // Проверка для массивов и объектов LatLngs
                     try {
                        currentElementBounds = element.getBounds();
                     } catch (e) {
                        console.warn("DEBUG: Ошибка при получении границ полилайна:", e, element);
                        currentElementBounds = null;
                     }
                } else {
                    currentElementBounds = null; // Нет точек - нет границ
                }
            }

            if (currentElementBounds && currentElementBounds.isValid && typeof currentElementBounds.isValid === 'function' && currentElementBounds.isValid()) {
                if (!collectiveBounds) {
                    collectiveBounds = currentElementBounds;
                } else {
                    collectiveBounds.extend(currentElementBounds);
                }
            }
        });

        if (collectiveBounds && collectiveBounds.isValid && typeof collectiveBounds.isValid === 'function' && collectiveBounds.isValid()) {
            const markerCount = [meetingPointMarker, routeStartMarker, endRouteMarker].filter(m => m !== null && map.hasLayer(m)).length;
            const hasVisiblePolyline = israelHikingPolyline && map.hasLayer(israelHikingPolyline) && israelHikingPolyline.getLatLngs && israelHikingPolyline.getLatLngs().length > 0;

            if (markerCount === 1 && !hasVisiblePolyline && activeMapElements[0] instanceof L.Marker) {
                 map.flyTo(activeMapElements[0].getLatLng(), MARKER_ZOOM_LEVEL);
            } else {
                 map.fitBounds(collectiveBounds.pad(0.15)); // Небольшой отступ для лучшего вида
            }
        } else if (activeMapElements.length === 1 && activeMapElements[0] instanceof L.Marker) {
            // Фоллбэк, если коллективные границы невалидны, но есть один маркер
            map.flyTo(activeMapElements[0].getLatLng(), MARKER_ZOOM_LEVEL);
        } else {
            console.log("DEBUG: Не удалось определить границы для fitBounds или нет активных элементов с валидными границами.");
        }
    } else {
         console.log("DEBUG: Нет активных элементов на карте для адаптации вида.");
         // Можно установить вид по умолчанию, если нужно
         // map.setView([31.771959, 35.217018], 8);
    }
}


/**
 * Обновляет координаты в Grist для указанного типа маркера.
 * @param {string} markerType - Тип маркера ('routeStart', 'meetingPoint', 'endRoute').
 * @param {number} lat - Широта.
 * @param {number} lng - Долгота.
 * @returns {Promise<boolean>} - true в случае успеха, false в случае ошибки.
 */
async function updateGristCoordinates(markerType, lat, lng) {
    const tableId = await getEnsuredTableId();

    if (!currentRecordId || !tableId) {
        console.warn(`ПРЕДУПРЕЖДЕНИЕ: Нет Record ID (${currentRecordId}) или Table ID (${tableId}) для updateGristCoordinates (${markerType})`);
        if (!tableId) {
             alert("Ошибка: Таблица для обновления координат не определена (updateGristCoordinates).");
        }
        return false; // Не удалось обновить
    }

    let updatePayload = {};
    switch (markerType) {
        case 'routeStart':
            updatePayload = { X: lat, Y: lng };
            break;
        case 'meetingPoint':
            updatePayload = { B: lat, C: lng };
            break;
        case 'endRoute':
            updatePayload = { Z: lat, AA: lng };
            break;
        default:
            console.error("ОШИБКА: Неизвестный тип маркера для обновления координат:", markerType);
            return false; // Неизвестный тип
    }

    try {
        await grist.docApi.applyUserActions([['UpdateRecord', tableId, currentRecordId, updatePayload]]);
        console.log(`DEBUG: Координаты Grist для "${markerType}" (Record ID: ${currentRecordId}) обновлены:`, updatePayload);
        return true; // Успешно обновлено
    } catch (error) {
        console.error(`ОШИБКА обновления Grist (${markerType} coords, Record ID: ${currentRecordId}):`, error);
        alert(`Ошибка при сохранении координат "${markerType}" в Grist: ${error.message}`);
        return false; // Ошибка при обновлении
    }
}

// === ОБРАБОТЧИКИ СОБЫТИЙ МАРКЕРОВ ===

async function onMeetingPointMarkerDragEnd(event) {
    const position = event.target.getLatLng();
    console.log(`DEBUG: "Место встречи" (синий) перетащено: ${position.lat}, ${position.lng}`);
    meetingPointJustUpdatedByAction = true; // Устанавливаем флаг, что это действие пользователя
    await updateGristCoordinates('meetingPoint', position.lat, position.lng);
    // После обновления координат, Grist вызовет handleGristRecordUpdate,
    // где meetingPointJustUpdatedByAction = true приведет к вызову processMeetingPointData
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

// === ОБРАБОТЧИК КЛИКА ПО КАРТЕ ===

/**
 * Обрабатывает клик по карте для установки нового маркера (если возможно).
 * @param {L.LeafletMouseEvent} event - Событие клика Leaflet.
 */
async function handleMapClick(event) {
    if (!event.latlng) {
        console.warn("ПРЕДУПРЕЖДЕНИЕ: Клик по карте без координат.");
        return;
    }

    // Пытаемся получить currentRecordId, если он еще не установлен (например, виджет только загрузился)
    if (!currentRecordId && grist.selectedRecord && typeof grist.selectedRecord.get === 'function') {
        try {
            const selectedRec = await grist.selectedRecord.get(); // Получаем текущую выбранную запись
            if (selectedRec && selectedRec.id) {
                currentRecordId = selectedRec.id;
                console.log(`DEBUG: handleMapClick - currentRecordId получен через selectedRecord.get(): ${currentRecordId}. Вызываем handleGristRecordUpdate.`);
                // Важно: после получения ID нужно вызвать handleGristRecordUpdate, чтобы синхронизировать состояние с этой записью
                // Это также загрузит существующие маркеры для этой записи, если они есть.
                await handleGristRecordUpdate(selectedRec, null); // Передаем полученную запись
            }
        } catch (err) {
            console.warn("Не удалось получить selectedRecord.id при клике на карте:", err);
        }
    }

    if (!currentRecordId) {
        alert("Сначала выберите строку в Grist, чтобы разместить на ней маркеры.");
        return;
    }

    const tableId = await getEnsuredTableId();
    if (!tableId) {
        alert("Ошибка: Таблица для обновления не определена. Проверьте конфигурацию виджета или выберите запись снова.");
        console.error("ОШИБКА: handleMapClick - Table ID не определен. Обновление невозможно.");
        return;
    }

    const clickedLat = event.latlng.lat;
    const clickedLng = event.latlng.lng;
    const clickPosition = { lat: clickedLat, lng: clickedLng };

    // Логика последовательной установки маркеров:
    // 1. Место встречи (если еще нет)
    // 2. Старт маршрута (если еще нет)
    // 3. Конец маршрута (если еще нет)
    if (!meetingPointMarker) {
        const label = `Место встречи (ID: ${currentRecordId})`;
        console.log(`DEBUG: Клик для установки "Место встречи" (синий): ${clickedLat}, ${clickedLng}.`);
        // Создаем маркер и сразу обновляем Grist. Это вызовет handleGristRecordUpdate.
        meetingPointMarker = updateOrCreateMarker(null, clickPosition, label, blueIcon, true, onMeetingPointMarkerDragEnd);
        meetingPointJustUpdatedByAction = true; // Важно для processMeetingPointData
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
        alert("Все три основных маркера (Место встречи, Старт, Конец) уже установлены. Для изменения их положения, перетащите существующие маркеры.");
    }
}

// === ПРОВЕРКА ГОТОВНОСТИ API И ЗАПУСК ===

/**
 * Проверяет готовность API Leaflet и Google Maps перед инициализацией карты.
 */
function checkApis() {
    const leafletReady = typeof L === 'object' && L.map;
    const googleMapsReady = typeof google === 'object' && google.maps && google.maps.DirectionsService; // Проверяем наличие DirectionsService
    const gristApiReady = typeof grist === 'object' && typeof grist.ready === 'function';

    console.log(`DEBUG: API check: Leaflet=${leafletReady}, Google Maps (Directions)=${googleMapsReady}, Grist API=${gristApiReady}`);

    if (leafletReady && googleMapsReady && gristApiReady) {
        console.log("DEBUG: Все API готовы. Инициализация карты...");
        initMap();
    } else {
        console.log("DEBUG: Одно или несколько API еще не готовы. Повторная проверка через 250 мс.");
        setTimeout(checkApis, 250); // Повторяем проверку через короткий интервал
    }
}

// Запуск проверки API при загрузке скрипта
console.log("DEBUG: grist_map_widget_hiking.js (v9.9.28_a - Israel Hiking Map): Запуск checkApis.");
checkApis();

// === КОНЕЦ СКРИПТА ===
