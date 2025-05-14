<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Grist Weather Fetcher</title>
    <script src="https://docs.getgrist.com/grist-plugin-api.js"></script>
    <style>
        body { font-family: sans-serif; padding: 10px; background-color: #f0f0f0; }
        #status { margin-top: 10px; padding: 8px; background-color: #fff; border-radius: 4px; min-height: 40px; white-space: pre-wrap; }
        .processing { color: blue; }
        .success { color: green; }
        .error { color: red; }
    </style>
</head>
<body>
    <h3>Получение погоды для походов</h3>
    <p>Выберите строку в Table1, чтобы получить температуру и прогноз для связанных дат и времени из Table2.</p>
    <div id="status">Ожидание выбора записи в Table1...</div>

    <script>
        // === ГЛОБАЛЬНЫЕ ПЕРЕМЕННЫЕ ===
        let currentTable1RecordId = null;
        let currentTable1Id = null; 
        
        const TABLE1_ROUTE_NAME_COL_ID = "A"; 
        const TABLE1_LAT_COL_ID = "B";        
        const TABLE1_LNG_COL_ID = "C";        

        const TABLE2_ID = "Table2"; 
        const TABLE2_HIKE_DATE_COL_ID = "A";     
        const TABLE2_HIKE_TIME_COL_ID = "K";     
        const TABLE2_ROUTE_NAME_COL_ID = "F";    
        const TABLE2_TEMPERATURE_COL_ID = "I";   
        const TABLE2_WEATHER_DESC_COL_ID = "J";  

        const statusDiv = document.getElementById('status');

        function transformColumnarData(columnarData) {
            if (!columnarData || typeof columnarData.id === 'undefined' || !Array.isArray(columnarData.id)) {
                console.warn("transformColumnarData: Данные не в ожидаемом колончатом формате или пусты.", columnarData);
                return Array.isArray(columnarData) ? columnarData : []; 
            }
            const numRows = columnarData.id.length;
            const rows = [];
            const columnIds = Object.keys(columnarData);
            for (let i = 0; i < numRows; i++) {
                const row = {};
                for (const colId of columnIds) {
                    if (columnarData[colId] && columnarData[colId].length > i) {
                        row[colId] = columnarData[colId][i];
                    } else { row[colId] = null; }
                }
                rows.push(row);
            }
            console.log("DEBUG: Данные преобразованы из колончатого формата:", rows);
            return rows;
        }

        function formatDate_YYYY_MM_DD(dateValue) {
            if (dateValue === null || dateValue === undefined || dateValue === 0) {
                console.warn("formatDate_YYYY_MM_DD: Получено пустое или нулевое значение даты:", dateValue);
                return null; 
            }
            let dateObj;
            if (typeof dateValue === 'number') { 
                dateObj = new Date(dateValue * 1000);
            } else if (dateValue instanceof Date) {
                dateObj = dateValue;
            } else {
                console.warn("Неверный формат даты для formatDate_YYYY_MM_DD:", dateValue, "(тип:", typeof dateValue, ")");
                return null;
            }
            if (isNaN(dateObj.getTime())) { 
                console.warn("Не удалось создать валидный объект Date из значения:", dateValue);
                return null;
            }
            const year = dateObj.getUTCFullYear(); 
            const month = String(dateObj.getUTCMonth() + 1).padStart(2, '0'); 
            const day = String(dateObj.getUTCDate()).padStart(2, '0');
            const formattedDate = `${year}-${month}-${day}`;
            console.log(`DEBUG: formatDate_YYYY_MM_DD: Отформатированная дата: ${formattedDate}`);
            return formattedDate;
        }

        function getWeatherDescriptionFromWMO(code) {
            const wmoDescriptions = {
                0: 'Ясно', 1: 'В основном ясно, облака рассеиваются', 2: 'Переменная облачность', 3: 'Пасмурно',
                45: 'Туман', 48: 'Изморозь (оседающий туман)',
                51: 'Морось: легкая', 53: 'Морось: умеренная', 55: 'Морось: сильная',
                56: 'Ледяная морось: легкая', 57: 'Ледяная морось: сильная',
                61: 'Дождь: слабый', 63: 'Дождь: умеренный', 65: 'Дождь: сильный',
                66: 'Ледяной дождь: слабый', 67: 'Ледяной дождь: сильный',
                71: 'Снегопад: слабый', 73: 'Снегопад: умеренный', 75: 'Снегопад: сильный',
                77: 'Снежные зерна',
                80: 'Ливень: слабый', 81: 'Ливень: умеренный', 82: 'Ливень: сильный (проливной)',
                85: 'Снежный ливень: слабый', 86: 'Снежный ливень: сильный',
                95: 'Гроза: слабая или умеренная', 
                96: 'Гроза со слабым градом', 
                99: 'Гроза с сильным градом'
            };
            const description = wmoDescriptions[code];
            if (description) {
                console.log(`DEBUG: getWeatherDescriptionFromWMO: код ${code} -> "${description}"`);
                return description;
            } else {
                console.warn(`DEBUG: getWeatherDescriptionFromWMO: Неизвестный WMO код: ${code}`);
                return `Погодный код ${code}`;
            }
        }

        async function getHourlyWeatherForHike(lat, lng, dateString, targetHour) {
            statusDiv.innerHTML += `Запрос погоды для ${dateString} на ${String(targetHour).padStart(2, '0')}:00...\n`;
            statusDiv.className = 'processing';
            console.log(`DEBUG: Запрос почасовой погоды: lat=${lat}, lng=${lng}, date=${dateString}, targetHour=${targetHour}`);

            if (!dateString || typeof lat !== 'number' || typeof lng !== 'number' || typeof targetHour !== 'number' || targetHour < 0 || targetHour > 23) {
                console.warn("DEBUG: getHourlyWeatherForHike - неверные параметры (дата/координаты/час).");
                return { temperature: "N/A (неверные параметры)", description: "N/A (неверные параметры)" };
            }
            
            const weatherApiUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lng.toFixed(4)}&hourly=temperature_2m,weathercode&start_date=${dateString}&end_date=${dateString}&timezone=auto`;
            
            try {
                const response = await fetch(weatherApiUrl);
                if (!response.ok) {
                    const errorData = await response.json().catch(() => ({ reason: "Не удалось получить детали ошибки" }));
                    console.error("Ошибка API Open-Meteo (hourly):", response.status, errorData);
                    throw new Error(`Open-Meteo API error: ${response.status} - ${errorData.reason || 'Unknown error'}`);
                }
                const data = await response.json();
                console.log("DEBUG: Ответ Open-Meteo (hourly):", data);
                
                let temperature = "N/A (нет данных)";
                let description = "N/A (нет данных)";
                let weatherCode = null;

                if (data && data.hourly && data.hourly.time && data.hourly.temperature_2m && data.hourly.weathercode) {
                    const targetISOStringPart = `${dateString}T${String(targetHour).padStart(2, '0')}:00`;
                    const hourIndex = data.hourly.time.findIndex(timeStr => timeStr.startsWith(targetISOStringPart));

                    if (hourIndex !== -1) {
                        console.log(`DEBUG: Найден индекс ${hourIndex} для времени ${targetISOStringPart}`);
                        const temp = data.hourly.temperature_2m[hourIndex];
                        if (temp !== null && temp !== undefined) {
                            temperature = `${temp.toFixed(1)} °C`;
                        }
                        weatherCode = data.hourly.weathercode[hourIndex];
                        if (weatherCode !== null && weatherCode !== undefined) {
                            description = getWeatherDescriptionFromWMO(weatherCode);
                        }
                    } else {
                        console.warn(`Не найдено данных для времени ${targetISOStringPart} в ответе Open-Meteo.`);
                    }
                } else {
                     console.warn("Open-Meteo не вернул ожидаемые почасовые данные (time, temperature_2m, weathercode).", data);
                }
                return { temperature, description, weatherCode }; 

            } catch (error) {
                console.error("ОШИБКА при запросе почасовой погоды Open-Meteo:", error);
                return { temperature: "Ошибка погоды", description: "Ошибка погоды", weatherCode: null };
            }
        }

        async function handleTable1Record(recordTable1, mappings) {
            if (!recordTable1 || typeof recordTable1.id === 'undefined') {
                statusDiv.textContent = "Запись в Table1 не выбрана или невалидна.";
                statusDiv.className = '';
                currentRecordId = null;
                return;
            }
            currentRecordId = recordTable1.id;
            console.log("DEBUG: Выбрана запись в Table1:", recordTable1);
            statusDiv.textContent = `Обработка записи ID ${currentRecordId} из Table1...\n`;
            statusDiv.className = 'processing';

            const routeNameTable1 = recordTable1[TABLE1_ROUTE_NAME_COL_ID];
            const latTable1 = recordTable1[TABLE1_LAT_COL_ID];
            const lngTable1 = recordTable1[TABLE1_LNG_COL_ID];

            if (typeof latTable1 !== 'number' || typeof lngTable1 !== 'number') {
                statusDiv.textContent = "Ошибка: В выбранной записи Table1 отсутствуют координаты (колонки B, C).";
                statusDiv.className = 'error'; return;
            }
            if (!routeNameTable1) {
                statusDiv.textContent = "Ошибка: В выбранной записи Table1 отсутствует Название маршрута (колонка A).";
                statusDiv.className = 'error'; return;
            }

            try {
                console.log(`DEBUG: Попытка загрузить ${TABLE2_ID}. ID для связи: "${routeNameTable1}"`);
                const rawTable2Data = await grist.docApi.fetchTable(TABLE2_ID);
                const table2Rows = transformColumnarData(rawTable2Data); 
                console.log(`DEBUG: Преобразованные данные из ${TABLE2_ID} (количество строк: ${table2Rows.length}):`, table2Rows);

                if (!Array.isArray(table2Rows)) { 
                    console.error(`ОШИБКА: Данные из ${TABLE2_ID} не удалось преобразовать в массив.`);
                    statusDiv.textContent = `Ошибка: не удалось обработать данные из таблицы ${TABLE2_ID}.`;
                    statusDiv.className = 'error'; return;
                }

                const matchingRowsInTable2 = table2Rows.filter(row => row && typeof row === 'object' && row[TABLE2_ROUTE_NAME_COL_ID] === routeNameTable1);

                if (matchingRowsInTable2.length === 0) {
                    statusDiv.textContent = `В ${TABLE2_ID} не найдено записей для маршрута "${routeNameTable1}".`;
                    statusDiv.className = ''; return;
                }

                let updatesMade = 0;
                statusDiv.innerHTML = `Найдено ${matchingRowsInTable2.length} записей в ${TABLE2_ID} для маршрута "${routeNameTable1}". Получение погоды...\n`;

                for (const rowTable2 of matchingRowsInTable2) {
                    const hikeDateTimestamp = rowTable2[TABLE2_HIKE_DATE_COL_ID];
                    const hikeTimeValue = rowTable2[TABLE2_HIKE_TIME_COL_ID]; // Значение из колонки K
                    
                    console.log(`DEBUG: Обработка строки Table2.id=${rowTable2.id}, дата (timestamp): ${hikeDateTimestamp}, значение времени из колонки K:`, hikeTimeValue, `(тип: ${typeof hikeTimeValue})`);
                    
                    const hikeDateFormatted = formatDate_YYYY_MM_DD(hikeDateTimestamp);
                    
                    if (!hikeDateFormatted) {
                        statusDiv.innerHTML += `Пропуск строки ID ${rowTable2.id} (неверная/пустая дата).\n`; continue;
                    }

                    let startHour = null;
                    let targetHour = 12; // Час по умолчанию

                    if (typeof hikeTimeValue === 'number' && hikeTimeValue > 0) { // Если K - timestamp
                        const timeObj = new Date(hikeTimeValue * 1000);
                        if (!isNaN(timeObj.getTime())) {
                            startHour = timeObj.getHours(); // Используем getHours() для локального времени браузера
                            console.log(`DEBUG: Извлечен час (локальный) из timestamp ${hikeTimeValue} (колонка K): ${startHour}`);
                        } else {
                             console.warn(`Не удалось создать валидный объект Date из timestamp ${hikeTimeValue} (колонка K).`);
                        }
                    } else if (typeof hikeTimeValue === 'string' && hikeTimeValue.includes(':')) { // Если K - строка "ЧЧ:ММ"
                        const parts = hikeTimeValue.split(':');
                        const parsedHour = parseInt(parts[0], 10);
                        if (!isNaN(parsedHour) && parsedHour >= 0 && parsedHour <= 23) {
                            startHour = parsedHour;
                             console.log(`DEBUG: Извлечен час из строки "${hikeTimeValue}" (колонка K): ${startHour}`);
                        } else {
                            console.warn(`Неверный формат времени (строка) "${hikeTimeValue}" в колонке K.`);
                        }
                    } else {
                        console.warn(`Время в колонке K (${hikeTimeValue}) не является числовым timestamp или строкой ЧЧ:ММ.`);
                    }

                    if (startHour !== null) {
                        targetHour = (startHour + 4); 
                        if (targetHour >= 24) { 
                            targetHour = 23; 
                            console.warn(`Целевой час (${startHour + 4}) выходит за пределы суток для даты ${hikeDateFormatted}, используется 23:00`);
                        }
                    } else {
                        console.warn(`Не удалось определить час начала похода из колонки K. Используется час по умолчанию: ${targetHour}:00`);
                    }
                    console.log(`DEBUG: Целевой час для запроса погоды: ${targetHour}`);


                    const weatherData = await getHourlyWeatherForHike(latTable1, lngTable1, hikeDateFormatted, targetHour);
                    
                    console.log(`DEBUG: Для ${TABLE2_ID}.id=${rowTable2.id}, дата=${hikeDateFormatted}, время=${String(targetHour).padStart(2, '0')}:00, ПОЛУЧЕНЫ ДАННЫЕ ПОГОДЫ:`, weatherData);
                    statusDiv.innerHTML += `Для даты ${hikeDateFormatted} на ${String(targetHour).padStart(2, '0')}:00: Темп.=${weatherData.temperature}, Описание=${weatherData.description}\n`;

                    const updatePayload = {};
                    let shouldUpdate = false;

                    if (weatherData.temperature !== "N/A (нет даты/коорд.)" && weatherData.temperature !== "Ошибка погоды" && weatherData.temperature !== "N/A (нет данных)") {
                        updatePayload[TABLE2_TEMPERATURE_COL_ID] = weatherData.temperature;
                        shouldUpdate = true;
                    }
                    
                    const isDescriptionValid = weatherData.description && 
                                             weatherData.description !== "N/A (нет даты/коорд.)" && 
                                             weatherData.description !== "Ошибка погоды" && 
                                             weatherData.description !== "N/A (нет данных)" &&
                                             !weatherData.description.startsWith("Неизвестный код"); 
                    
                    if (isDescriptionValid) {
                        updatePayload[TABLE2_WEATHER_DESC_COL_ID] = weatherData.description; 
                        shouldUpdate = true;
                    } else {
                        console.warn(`DEBUG: Описание погоды для ${TABLE2_ID}.id=${rowTable2.id} невалидно или отсутствует: "${weatherData.description}"`);
                    }
                    
                    console.log(`DEBUG: Для ${TABLE2_ID}.id=${rowTable2.id}, updatePayload ПЕРЕД отправкой:`, JSON.parse(JSON.stringify(updatePayload)), `shouldUpdate: ${shouldUpdate}`);

                    if (shouldUpdate && Object.keys(updatePayload).length > 0) {
                        await grist.docApi.applyUserActions([
                            ['UpdateRecord', TABLE2_ID, rowTable2.id, updatePayload]
                        ]);
                        updatesMade++;
                        console.log(`DEBUG: Обновлены данные для ${TABLE2_ID}.id=${rowTable2.id}:`, updatePayload);
                    } else {
                        console.log(`DEBUG: Обновление для ${TABLE2_ID}.id=${rowTable2.id} не требуется или payload пуст.`);
                    }
                }
                if (updatesMade > 0) {
                    statusDiv.innerHTML += `<b>Успешно обновлено ${updatesMade} записей в ${TABLE2_ID}!</b>`;
                    statusDiv.className = 'success';
                } else {
                    statusDiv.innerHTML += `Не удалось обновить данные в ${TABLE2_ID} (возможно, нет новых данных или были ошибки).`;
                    statusDiv.className = 'error';
                }

            } catch (error) {
                console.error("ОШИБКА при обработке записи Table1 или обновлении Table2:", error);
                statusDiv.textContent = `Ошибка: ${error.message}`;
                statusDiv.className = 'error';
            }
        }

        function initGrist() {
            console.log("DEBUG: initGrist() called");
            if (typeof grist === 'undefined' || !grist.ready) {
                console.error("Grist API не найден. Убедитесь, что скрипт запущен внутри Grist.");
                statusDiv.textContent = "Ошибка: Grist API не найден.";
                statusDiv.className = 'error';
                return;
            }

            grist.ready({
                requiredAccess: 'full', 
                columns: [ 
                    { name: TABLE1_ROUTE_NAME_COL_ID, type: 'Text' },
                    { name: TABLE1_LAT_COL_ID, type: 'Numeric' },
                    { name: TABLE1_LNG_COL_ID, type: 'Numeric' },
                ]
            });

            grist.onOptions((options, interaction) => {
                console.log("DEBUG: grist.onOptions - options:", options, "interaction:", interaction);
                currentTable1Id = (options?.tableId) || (interaction?.tableId) || null;
                if (currentTable1Id) {
                    console.log(`DEBUG: ID основной таблицы (Table1) установлен: ${currentTable1Id}`);
                } else {
                    console.error("ОШИБКА КРИТИЧЕСКАЯ: ID основной таблицы (Table1) не предоставлен виджету. Убедитесь, что виджет связан с Table1.");
                    statusDiv.textContent = "Ошибка конфигурации: виджет не связан с Table1.";
                    statusDiv.className = 'error';
                }
            });

            grist.onRecord(handleTable1Record);
            console.log("DEBUG: Grist API настроен и готов. Версия виджета: v1.11");
            statusDiv.textContent = "Виджет готов. Выберите строку в Table1.";
        }
        initGrist();
    </script>
</body>
</html>
