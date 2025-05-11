// === ПОЛНЫЙ КОД JAVASCRIPT ВИДЖЕТА (Версия для GitHub, исправленная) ===
 
// === ГЛОБАЛЬНЫЕ ПЕРЕМЕННЫЕ ===
let map; // Объект Leaflet Map
let marker = null; // Объект Leaflet Marker
let currentRecordId = null; // ID выбранной строки Grist
let currentTableId = null;  // ID таблицы Grist
const apiKey = 'AIzaSyC-NbhYb2Dh4wRcJnVADh3KU7IINUa6pB8'; // ВАЖНО: Ваш ключ API для Google сервисов. Убедитесь, что он активен для Maps JavaScript API, Directions API и Cloud Translation API в Google Cloud Console.
const MARKER_ZOOM_LEVEL = 15; // Уровень зума при переходе к маркеру

// === ВСПОМОГАТЕЛЬНАЯ ФУНКЦИЯ ПЕРЕВОДА ===
/**
 * Переводит текст с помощью Google Cloud Translation API V2.
 * @param {string} text - Текст для перевода.
 * @param {string} targetLang - Целевой язык (например, 'ru').
 * @param {string} apiKey - API ключ для Google Translation API.
 * @returns {Promise<string>} Промис, разрешающийся переведенным текстом или исходным текстом в случае ошибки.
 */
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
        const responseBody = await response.text(); // Сначала получаем тело как текст для отладки
        console.log(`DEBUG: Статус ответа Translation API для "${text}": ${response.status}`);

        if (!response.ok) {
            console.error(`DEBUG: Ошибка Translation API (${response.status}) для "${text}". Тело ответа: ${responseBody}`);
            throw new Error(`Translation API error ${response.status} for text: "${text}"`);
        }

        const data = JSON.parse(responseBody); // Парсим JSON после проверки response.ok

        if (data?.data?.translations?.[0]?.translatedText) {
            const translated = data.data.translations[0].translatedText;
            console.log(`DEBUG: Перевод успешен: "${text}" -> "${translated}"`);
            // Декодируем HTML-сущности, которые может вернуть Google Translate (например, &#39; для ')
            const tempElem = document.createElement('textarea');
            tempElem.innerHTML = translated;
            return tempElem.value;
        } else {
            console.warn(`DEBUG: Translation API вернул неожиданную структуру для "${text}". Ответ:`, data);
            return text; // Возвращаем исходный текст
        }
    } catch (error) {
        console.error(`DEBUG: Сбой fetch или парсинга JSON при переводе для "${text}":`, error);
        return text; // Возвращаем исходный текст в случае ошибки
    }
}

/**
 * Получает время в пути и проверяет предупреждения для одного маршрута с помощью Google Directions API.
 * @param {google.maps.LatLngLiteral} originLatLng - Координаты начала.
 * @param {google.maps.LatLngLiteral} destinationLatLng - Координаты конца.
 * @param {Date} departureTime - Время отправления.
 * @returns {Promise<string>} Промис, разрешающийся текстом времени в пути (например, "1 час 20 мин") или сообщением об ошибке.
 */
async function getTravelTime(originLatLng, destinationLatLng, departureTime) {
    let travelTimeResult = 'N/A'; // Значение по умолчанию
    console.log(`DEBUG: Запрос времени в пути Google Directions от ${JSON.stringify(originLatLng)} до ${JSON.stringify(destinationLatLng)} на ${departureTime.toISOString()}`);

    try {
        if (typeof google === 'undefined' || !google?.maps?.DirectionsService) {
            console.error("DEBUG: Google Maps API или DirectionsService не загружен.");
            throw new Error("Google Directions Service not loaded. Check API key and if 'Directions API' is enabled in Google Cloud Console.");
        }
        const service = new google.maps.DirectionsService();
        const directionsRequest = {
            origin: originLatLng,
            destination: destinationLatLng,
            travelMode: google.maps.TravelMode.DRIVING,
            drivingOptions: {
                departureTime: departureTime,
                trafficModel: google.maps.TrafficModel.BEST_GUESS // Учитывает текущий и прогнозируемый трафик
            }
        };

        const directionsResult = await new Promise((resolve, reject) => {
            service.route(directionsRequest, (response, status) => {
                if (status === google.maps.DirectionsStatus.OK) {
                    resolve(response);
                } else {
                    console.error(`DEBUG: Ошибка Google Directions API: статус ${status}. Запрос:`, directionsRequest);
                    reject(new Error(`Directions status: ${status}. This might be due to API key issues, 'Directions API' not enabled, or no route found.`));
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
                const borderKeywords = ['border', 'границ', 'checkpoint', 'crossing', 'territories', 'territory', 'таможн']; // Добавил "таможн"
                // Предупреждения могут быть не строками, проверяем тип
                const hasBorderWarning = warnings.some(w => typeof w === 'string' && borderKeywords.some(k => w.toLowerCase().includes(k.toLowerCase())));
                if (hasBorderWarning) {
                    console.error("!!! ОБНАРУЖЕНО ПРЕДУПРЕЖДЕНИЕ О ВОЗМОЖНОМ ПЕРЕСЕЧЕНИИ ГРАНИЦЫ/ОСОБОЙ ЗОНЫ !!!");
                    travelTimeResult += " (ПРЕДУПРЕЖДЕНИЕ О ГРАНИЦЕ!)";
                }
            } else {
                console.log("DEBUG: Предупреждений по маршруту нет.");
            }
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

/**
 * Инициализация карты Leaflet.
 */
function initMap() {
    console.log("DEBUG: Вызов initMap() для Leaflet.");
    const initialCoords = [31.771959, 35.217018]; // Координаты для центра Израиля (примерно Иерусалим)
    const initialZoom = 8; // Общий зум для страны
    try {
        const mapDiv = document.getElementById('map');
        if (!mapDiv) {
            console.error("ОШИБКА: Контейнер для карты #map не найден в DOM!");
            return;
        }
        map = L.map('map').setView(initialCoords, initialZoom);
        console.log("DEBUG: Объект Leaflet Map создан.");

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19,
            attribution: 'Картографические данные &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> участники'
        }).addTo(map);
        console.log("DEBUG: Слой тайлов OpenStreetMap добавлен.");

        map.on('click', handleMapClick);
        console.log("DEBUG: Обработчик клика по карте Leaflet добавлен.");

        setupGrist(); // Настраиваем интеграцию с Grist после инициализации карты
    } catch (e) {
        console.error("ОШИБКА: Не удалось создать объект Leaflet Map:", e);
    }
}

/**
 * Настройка взаимодействия с Grist API.
 */
function setupGrist() {
    if (typeof grist === 'undefined' || !grist.ready) {
        console.error("ОШИБКА: Grist API не найден или не готов. Убедитесь, что grist-plugin-api.js загружен.");
        return;
    }
    console.log("DEBUG: Настройка взаимодействия с Grist...");
    grist.ready({
        requiredAccess: 'full', // Запрашиваем полный доступ
        columns: [ // Определяем все колонки, с которыми будет работать виджет
            { name: "A", type: 'Text', optional: true, title: 'Название (для метки)' },
            { name: "B", type: 'Numeric', title: 'Широта' }, // Обязательное поле для отображения на карте
            { name: "C", type: 'Numeric', title: 'Долгота' }, // Обязательное поле для отображения на карте
            { name: "D", type: 'Text', optional: true, title: 'Город/Поселение (RU)' },
            { name: "E", type: 'Text', optional: true, title: 'Район (RU)' },
            { name: "F", type: 'Text', optional: true, title: 'Округ (RU)' },
            { name: "H", type: 'Text', optional: true, title: 'Микрорайон/Деревня (RU)' },
            { name: "I", type: 'Text', optional: true, title: 'Время в пути из Тель-Авива' },
            { name: "J", type: 'Text', optional: true, title: 'Время в пути из Иерусалима' },
            { name: "K", type: 'Text', optional: true, title: 'Время в пути из Хайфы' },
            { name: "L", type: 'Text', optional: true, title: 'Время в пути из Беэр-Шевы' }
        ]
    });

    grist.onOptions(handleOptionsUpdate); // Обработчик изменения настроек виджета (если есть)
    grist.onRecord(handleGristRecordUpdate); // Обработчик выбора строки в Grist
    console.log("DEBUG: Grist API готов, слушаем события выбора записей и опций...");
}

/**
 * Обрабатывает опции, переданные Grist (например, tableId при связывании виджета).
 */
function handleOptionsUpdate(options, interaction) {
    console.log("DEBUG: Grist: Получено обновление опций:", options, "Interaction:", interaction);
    let foundTableId = null;
    if (options && options.tableId) { // Стандартный способ получения tableId
        foundTableId = options.tableId;
    } else if (interaction && interaction.tableId) { // Альтернативный способ из объекта interaction
        foundTableId = interaction.tableId;
    }
    // Можно добавить логику для получения tableId из кастомных настроек виджета, если они есть

    if (foundTableId) {
        currentTableId = foundTableId;
        console.log(`DEBUG: Текущий Table ID установлен: ${currentTableId}`);
    } else {
        console.warn("ПРЕДУПРЕЖДЕНИЕ: Не удалось найти tableId в опциях или interaction. Убедитесь, что виджет связан с таблицей в Grist.");
        currentTableId = null;
    }
}

/**
 * Обработчик данных из Grist при выборе строки. Отображает маркер на карте.
 */
function handleGristRecordUpdate(record, mappings) {
    console.log("DEBUG: Grist: Получено обновление записи:", record, "Сопоставления (mappings):", mappings);
    if (!map) {
        console.warn("ПРЕДУПРЕЖДЕНИЕ: Карта не инициализирована при обновлении записи Grist.");
        return;
    }

    currentRecordId = record ? record.id : null; // Сохраняем ID текущей выбранной записи
    console.log("DEBUG: Текущий выбранный Record ID:", currentRecordId);

    if (!record || typeof record.id === 'undefined') { // Если запись не выбрана или невалидна
        if (marker) {
            marker.remove(); // Удаляем маркер с карты
            marker = null;
            console.log("DEBUG: Маркер удален, так как запись Grist не выбрана или невалидна.");
        }
        return;
    }

    // Получаем координаты из полей B (Широта) и C (Долгота)
    const lat = record.B;
    const lng = record.C;

    // Формируем метку для маркера, используя доступные поля A (Название) или D (Город)
    const label = record.A || record.D || `ID Записи: ${record.id}`;

    if (typeof lat === 'number' && !isNaN(lat) && typeof lng === 'number' && !isNaN(lng)) {
        updateMarkerOnMap({ lat: lat, lng: lng }, label); // Обновляем маркер на карте
    } else {
        console.warn("ПРЕДУПРЕЖДЕНИЕ: Невалидные или отсутствующие координаты в записи Grist. Невозможно обновить маркер.", { lat, lng });
        if (marker) { // Если координаты невалидны, удаляем существующий маркер
            marker.remove();
            marker = null;
        }
    }
}
/**
 * Обрабатывает клик по карте: получает адрес (Nominatim), переводит (Google Translate),
 * получает время в пути из 4-х городов (Google Directions) и обновляет запись в Grist.
 * @param {L.LeafletMouseEvent} e - Событие клика Leaflet.
 */
async function handleMapClick(e) {
    if (!e.latlng) {
        console.warn("ПРЕДУПРЕЖДЕНИЕ: Событие клика по карте не содержит координат (latlng).");
        return;
    }
    if (!currentRecordId) {
        alert("Пожалуйста, сначала выберите строку в таблице Grist, которую вы хотите обновить координатами с карты.");
        console.warn("ПРЕДУПРЕЖДЕНИЕ: Клик по карте, но не выбрана запись в Grist (currentRecordId is null). Обновление невозможно.");
        return;
    }

    const lat = e.latlng.lat;
    const lng = e.latlng.lng;
    const positionLeaflet = e.latlng; // Объект L.LatLng
    const destinationLatLngGoogle = { lat: lat, lng: lng }; // Объект LatLngLiteral для Google API
    const tempLabel = `Обработка координат... (${lat.toFixed(4)}, ${lng.toFixed(4)})`;

    console.log(`DEBUG: Клик по карте в точке: Широта ${lat}, Долгота ${lng}`);
    updateMarkerOnMap(positionLeaflet, tempLabel); // Сразу обновляем маркер с временной меткой

    // --- Переменные для результатов ---
    let cityLevel_local = '', countyLevel_local = '', stateLevel_local = '', suburbLevel_local = '';
    let cityLevel_ru = '', countyLevel_ru = '', stateLevel_ru = '', suburbLevel_ru = '';
    let travelTimeTA = 'N/A', travelTimeJerusalem = 'N/A', travelTimeHaifa = 'N/A', travelTimeBeersheba = 'N/A';

    // --- 1. Обратное геокодирование через Nominatim (OSM) ---
    // Добавляем &accept-language=en для получения результатов на английском, что упрощает последующий перевод.
    const nominatimUrl = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1&accept-language=en`;
    console.log("DEBUG: Запрос к Nominatim для обратного геокодирования:", nominatimUrl);
    try {
        const response = await fetch(nominatimUrl);
        if (!response.ok) {
            console.error(`ОШИБКА: Nominatim API вернул статус ${response.status}`);
            throw new Error(`Nominatim API error ${response.status}`);
        }
        const data = await response.json();
        console.log("DEBUG: Ответ от Nominatim:", data);
        if (data && data.address) {
            const addr = data.address;
            // Пытаемся получить наиболее релевантные части адреса
            cityLevel_local = addr.city || addr.town || addr.village || addr.hamlet || '';
            countyLevel_local = addr.county || addr.state_district || ''; // Район/Округ (область)
            stateLevel_local = addr.state || ''; // Более крупная административная единица (если есть)
            suburbLevel_local = addr.suburb || addr.neighbourhood || addr.borough || addr.quarter || ''; // Микрорайон/Квартал
            console.log(`DEBUG: Данные из Nominatim (локальные): Город='${cityLevel_local}', Район/Округ='${countyLevel_local}', Область/Штат='${stateLevel_local}', Микрорайон='${suburbLevel_local}'`);

            // --- 2. Перевод компонентов адреса на русский ---
            console.log("DEBUG: Перевод компонентов адреса на русский язык...");
            [cityLevel_ru, countyLevel_ru, stateLevel_ru, suburbLevel_ru] = await Promise.all([
                translateText(cityLevel_local, 'ru', apiKey),
                translateText(countyLevel_local, 'ru', apiKey),
                translateText(stateLevel_local, 'ru', apiKey),
                translateText(suburbLevel_local, 'ru', apiKey)
            ]);
            console.log(`DEBUG: Переведенные компоненты: Город(D)='${cityLevel_ru}', Район/Округ(E)='${countyLevel_ru}', Область/Штат(F)='${stateLevel_ru}', Микрорайон(H)='${suburbLevel_ru}'`);
        } else {
            console.warn("ПРЕДУПРЕЖДЕНИЕ: Nominatim не вернул данные адреса или вернул неожиданную структуру.");
            cityLevel_ru = "Адрес не найден"; // Запасное значение
        }
    } catch (error) {
        console.error("ОШИБКА: Сбой обратного геокодирования Nominatim или перевода:", error);
        cityLevel_ru = "Ошибка геокодирования"; // Запасное значение
    }

    // --- 3. Расчет времени в пути через Google Directions Service для 4-х городов ---
    // Логика для "следующей пятницы в 7 утра"
    const now = new Date(); // Текущее время браузера пользователя
    const departureDate = new Date(now.valueOf()); // Создаем клон для изменений

    const currentDay = departureDate.getDay(); // 0 (Воскресенье) - 6 (Суббота)
    const currentHour = departureDate.getHours();
    let daysToAdd = (5 - currentDay + 7) % 7; // 5 соответствует пятнице
    if (daysToAdd === 0 && currentHour >= 7) { // Если сегодня пятница и уже 7 утра или позже
        daysToAdd = 7; // то берем следующую пятницу
    }
    departureDate.setDate(departureDate.getDate() + daysToAdd);
    departureDate.setHours(7, 0, 0, 0); // Устанавливаем время на 7:00:00.000

    console.log(`DEBUG: Расчет времени в пути на будущую дату отправления: ${departureDate.toString()} (локальное время браузера)`);

    const origins = [
        { name: 'Тель-Авив', coords: { lat: 32.0853, lng: 34.7818 } },
        { name: 'Иерусалим', coords: { lat: 31.7683, lng: 35.2137 } },
        { name: 'Хайфа', coords: { lat: 32.7940, lng: 34.9896 } },
        { name: 'Беэр-Шева', coords: { lat: 31.2530, lng: 34.7915 } }
    ];

    try {
        const results = await Promise.all(
            origins.map(origin => getTravelTime(origin.coords, destinationLatLngGoogle, departureDate))
        );
        travelTimeTA = results[0] || 'N/A';
        travelTimeJerusalem = results[1] || 'N/A';
        travelTimeHaifa = results[2] || 'N/A';
        travelTimeBeersheba = results[3] || 'N/A';
        console.log(`DEBUG: Получено время в пути: Тель-Авив=${travelTimeTA}, Иерусалим=${travelTimeJerusalem}, Хайфа=${travelTimeHaifa}, Беэр-Шева=${travelTimeBeersheba}`);
    } catch (error) {
        // Ошибки из getTravelTime уже должны быть залогированы.
        // Promise.all отклоняется, если хотя бы один из промисов отклонен.
        console.error("ОШИБКА: Один или несколько запросов Google Directions завершились неудачей во время Promise.all.", error);
        // Устанавливаем значения по умолчанию, если они не были переопределены успешными вызовами
        travelTimeTA = travelTimeTA === 'N/A' ? 'Google: Ошибка' : travelTimeTA;
        travelTimeJerusalem = travelTimeJerusalem === 'N/A' ? 'Google: Ошибка' : travelTimeJerusalem;
        travelTimeHaifa = travelTimeHaifa === 'N/A' ? 'Google: Ошибка' : travelTimeHaifa;
        travelTimeBeersheba = travelTimeBeersheba === 'N/A' ? 'Google: Ошибка' : travelTimeBeersheba;
    }

    // --- 4. Обновление записи в Grist ---
    // Формируем финальную метку для маркера на основе полученных данных
    const finalLabel = cityLevel_ru && stateLevel_ru ? `${cityLevel_ru}, ${stateLevel_ru}` : (cityLevel_ru || `Точка (${lat.toFixed(4)}, ${lng.toFixed(4)})`);
    updateMarkerOnMap(positionLeaflet, finalLabel); // Обновляем маркер с финальной, более информативной меткой

    let tableIdToUse = currentTableId;
    // Попытка получить tableId из активной таблицы, если currentTableId не был установлен через onOptions
    if (!tableIdToUse && grist.selectedTable?.getTableId) {
        try {
            const id = await grist.selectedTable.getTableId();
            if (id) {
                tableIdToUse = id;
                currentTableId = id; // Сохраняем для будущих кликов, если получили таким способом
                console.log(`DEBUG: Резервный способ: Table ID установлен из grist.selectedTable: ${tableIdToUse}`);
            }
        } catch (e) {
            console.warn("ПРЕДУПРЕЖДЕНИЕ: Не удалось получить tableId из grist.selectedTable.getTableId() как резервный вариант:", e);
        }
    }

    if (currentRecordId !== null && tableIdToUse !== null && typeof tableIdToUse === 'string') {
        console.log(`DEBUG: Попытка обновить запись Grist ID: ${currentRecordId} в таблице ID: ${tableIdToUse}`);
        try {
            if (!grist.docApi?.applyUserActions) {
                console.error("ОШИБКА: grist.docApi или grist.docApi.applyUserActions недоступны.");
                throw new Error("Grist docApi or applyUserActions method is not available.");
            }
            const updateData = {
                'B': lat, 'C': lng, // Координаты
                'D': cityLevel_ru, 'E': countyLevel_ru,
                'F': stateLevel_ru, 'H': suburbLevel_ru, // Адресные компоненты
                'I': travelTimeTA,         // Время в пути из Тель-Авива
                'J': travelTimeJerusalem,  // Время в пути из Иерусалима
                'K': travelTimeHaifa,      // Время в пути из Хайфы
                'L': travelTimeBeersheba   // Время в пути из Беэр-Шевы
            };

            // Удаляем поля с undefined или null значениями из объекта updateData,
            // чтобы не перезаписывать существующие значения в Grist пустыми, если данные не были получены.
            Object.keys(updateData).forEach(key => (updateData[key] === undefined || updateData[key] === null) && delete updateData[key]);

            const userActions = [ ['UpdateRecord', tableIdToUse, currentRecordId, updateData] ];
            console.log("DEBUG: Применение действий пользователя Grist:", JSON.stringify(userActions, null, 2));
            await grist.docApi.applyUserActions(userActions);
            console.log(`DEBUG: Действие по обновлению записи Grist ${currentRecordId} успешно отправлено.`);
        } catch (error) {
            console.error(`ОШИБКА: Не удалось применить действия пользователя к Grist:`, error);
            alert(`Ошибка обновления данных в Grist: ${error.message}`);
        }
    } else {
        console.warn("ПРЕДУПРЕЖДЕНИЕ: Невозможно обновить запись Grist из-за невалидных параметров:", { currentRecordId, tableIdToUse });
        if (currentRecordId === null) {
            // Сообщение уже было показано выше, но можно добавить специфичное для этого этапа
            // alert("Запись в Grist не выбрана. Кликните на строку в таблице, чтобы выбрать ее для обновления координат.");
        } else if (tableIdToUse === null) {
            alert("Не удалось определить таблицу Grist для обновления. Убедитесь, что виджет правильно связан с таблицей.");
        }
    }
}

/**
 * Создает или обновляет маркер Leaflet на карте и плавно перемещает карту к нему.
 * @param {L.LatLng | {lat: number, lng: number}} position - Позиция для маркера (объект Leaflet LatLng или литерал {lat, lng}).
 * @param {string} label - Текст для всплывающей подсказки (tooltip) маркера.
 */
function updateMarkerOnMap(position, label) {
    if (!map) {
        console.warn("ПРЕДУПРЕЖДЕНИЕ: Карта не инициализирована, невозможно обновить маркер.");
        return;
    }

    // Преобразуем позицию в объект L.LatLng, если это необходимо
    const latLng = (position instanceof L.LatLng) ? position : L.latLng(position.lat, position.lng);

    if (!marker) { // Если маркер еще не создан
        marker = L.marker(latLng, { title: label }).addTo(map); // title - для нативной подсказки браузера
        marker.bindTooltip(label).openTooltip(); // bindTooltip - для кастомной подсказки Leaflet, openTooltip - чтобы сразу показать
        console.log(`DEBUG: Маркер Leaflet создан. Позиция: ${latLng.toString()}, Метка: "${label}"`);
    } else { // Если маркер уже существует, обновляем его
        marker.setLatLng(latLng);
        if (marker.getElement()) { // Обновляем нативный title, если элемент маркера доступен
            marker.getElement().title = label;
        }
        // Обновляем существующий тултип Leaflet или создаем новый, если его нет
        if (marker.getTooltip()) {
            marker.setTooltipContent(label);
        } else {
            marker.bindTooltip(label);
        }
        if (!marker.isTooltipOpen()) { // Открываем тултип, если он был закрыт или только что создан
            marker.openTooltip();
        }
        if (!map.hasLayer(marker)) { // На всякий случай, если маркер был удален с карты другим способом
            marker.addTo(map);
        }
        console.log(`DEBUG: Маркер Leaflet обновлен. Позиция: ${latLng.toString()}, Метка: "${label}"`);
    }
    map.flyTo(latLng, MARKER_ZOOM_LEVEL); // Плавно перемещаем карту к маркеру
}

// === БЛОК РУЧНОЙ ИНИЦИАЛИЗАЦИИ (Ожидаем готовности Leaflet И Google Maps) ===
/**
 * Проверяет готовность API Leaflet и Google Maps (включая DirectionsService).
 * Если оба API готовы, вызывает initMap(). В противном случае, повторяет проверку через 250 мс.
 */
function checkApis() {
    console.log("DEBUG: === ВХОД в checkApis ===");
    const leafletReady = typeof L === 'object' && L !== null && typeof L.map === 'function';
    // Критически важно проверить именно google.maps.DirectionsService, так как он нужен для расчета маршрутов
    const googleReady = typeof google === 'object' && typeof google.maps === 'object' && typeof google.maps.DirectionsService === 'function';
    console.log(`DEBUG: Статус готовности: Leaflet = ${leafletReady}, Google Maps (с DirectionsService) = ${googleReady}`);

    if (leafletReady && googleReady) {
        console.log("DEBUG: Оба API (Leaflet и Google Maps с DirectionsService) готовы.");
        initMap(); // Инициализируем карту, только когда все зависимости загружены
    } else {
        console.warn("ПРЕДУПРЕЖДЕНИЕ: Проверка API НЕ ПРОЙДЕНА. Одно или оба API (Leaflet или Google Maps DirectionsService) не готовы. Повторная попытка через 250 мс...");
        setTimeout(checkApis, 250); // Повторяем проверку
    }
    console.log("DEBUG: === ВЫХОД из checkApis (возможен повторный вызов через setTimeout) ===");
}

// === ТОЧКА ВХОДА: Начинаем проверку готовности API для инициализации виджета ===
console.log("DEBUG: Вызов checkApis для запуска процесса инициализации виджета.");
checkApis(); // Запускаем первоначальную проверку и последующую инициализацию

console.log("DEBUG: Скрипт grist_map_widget_hiking.js выполнен, процесс инициализации запущен.");
// === КОНЕЦ СКРИПТА ===
