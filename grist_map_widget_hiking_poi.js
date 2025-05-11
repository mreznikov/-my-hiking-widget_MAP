// === ПОЛНЫЙ КОД JAVASCRIPT ВИДЖЕТА (Версия #226b - Полная, двусторонняя синхронизация, улучшен setCursorPos) ===

// === ГЛОБАЛЬНЫЕ ПЕРЕМЕННЫЕ ===
let map;
let currentTableId = null;  // ID таблицы Table7 ("Детали Маршрута")
let currentRecordId = null; // ID текущей выбранной строки в Table7
const MARKER_ZOOM_LEVEL = 15;
let poiMarkersLayer = null; // Слой для хранения маркеров POI
let g_currentRouteActualRefId = null; // ID связанной строки из Table1

// === ОСНОВНЫЕ ФУНКЦИИ ВИДЖЕТА ===

function initMap() {
    console.log("DEBUG: initMap: Leaflet initMap() for Israel Hiking Map called.");
    const initialCoords = [31.5, 34.8]; const initialZoom = 8;
    try {
        const mapDiv = document.getElementById('map');
        if (!mapDiv) { console.error("DEBUG: initMap: Map container #map not found!"); return; }
        map = L.map('map').setView(initialCoords, initialZoom);
        console.log("DEBUG: initMap: Leaflet Map object created.");
        L.tileLayer('https://israelhiking.osm.org.il/English/Tiles/{z}/{x}/{y}.png', {
            maxZoom: 16, minZoom: 7,
            attribution: 'Tiles &copy; <a href="https://israelhiking.osm.org.il" target="_blank">Israel Hiking Map</a> CC BY-NC-SA 3.0 | Map data &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> contributors'
        }).addTo(map);
        console.log("DEBUG: initMap: OSM TileLayer (Israel Hiking) added.");
        poiMarkersLayer = L.layerGroup().addTo(map);
        console.log("DEBUG: initMap: poiMarkersLayer initialized and added to map.");
        map.on('click', handleMapClick);
        console.log("DEBUG: initMap: Leaflet map click listener added.");
        setupGrist();
    } catch (e) {
        console.error("DEBUG: initMap: Error creating Leaflet Map object:", e);
        alert("Error creating Leaflet Map: " + e.message);
    }
}

function setupGrist() {
     if (typeof grist === 'undefined' || !grist.ready) { console.error("DEBUG: setupGrist: Grist API not found..."); return; }
     console.log("DEBUG: setupGrist: Setting up Grist interaction...");
    grist.ready({
        requiredAccess: 'full',
        columns: [
            { name: "A", type: 'Any',    optional: true, title: 'Название Маршрута (Формула Grist)' },
            { name: "B", type: 'Text',    title: 'Тип объекта' },
            { name: "C", type: 'Numeric', title: 'Широта' },
            { name: "D", type: 'Numeric', title: 'Долгота' },
            { name: "G", type: 'Text', optional: true, title: 'Описание POI' },
            // ВАЖНО: Замените 'RouteLink' на РЕАЛЬНЫЙ ID вашей колонки-ссылки в Table7!
            { name: "RouteLink", type: 'Any', title: 'ID Связанного Маршрута (Ref->Table1)' }
        ]
    });
    grist.onOptions(handleOptionsUpdate);
    grist.onRecords(loadExistingPOIs);
    grist.onRecord(handleGristRecordUpdate);
    console.log("DEBUG: setupGrist: Grist API ready, listening for records and options...");
}

function handleOptionsUpdate(options, interaction) {
    console.log("DEBUG: handleOptionsUpdate: Grist: Received options update:", options);
    let foundTableId = null;
    if (options && options.tableId) {
        foundTableId = options.tableId;
        console.log("DEBUG: handleOptionsUpdate: tableId found in options:", foundTableId);
    } else if (interaction && interaction.tableId) {
        foundTableId = interaction.tableId;
        console.log("DEBUG: handleOptionsUpdate: tableId found in interaction:", foundTableId);
    } else if (options && options.tableRef) {
        foundTableId = String(options.tableRef);
        console.log("DEBUG: handleOptionsUpdate: tableId found in options.tableRef:", foundTableId);
    }

    if (foundTableId) {
         currentTableId = String(foundTableId);
         console.log(`DEBUG: handleOptionsUpdate: Current Table ID (Table7) set to: ${currentTableId}`);
    } else {
        console.warn("DEBUG: handleOptionsUpdate: Could not find tableId for Table7 directly in options/interaction.");
        if (currentTableId === null && grist.selectedTable && typeof grist.selectedTable.getTableId === 'function') {
            grist.selectedTable.getTableId().then(id => {
                if (id && typeof id === 'string') {
                    currentTableId = id;
                    console.log(`DEBUG: handleOptionsUpdate: (async) Current Table ID (Table7) set to: ${currentTableId}`);
                }
            }).catch(err => console.error("DEBUG: handleOptionsUpdate: (async) Error getting tableId:", err));
        }
    }
}

// Версия из #225 (исправленный парсинг record.RouteLink)
function handleGristRecordUpdate(record, mappings) {
    console.log("DEBUG: handleGristRecordUpdate: Raw 'record' object received from Grist:", JSON.parse(JSON.stringify(record || {})));

    if (!map) { console.error("DEBUG: handleGristRecordUpdate: Map not initialized yet."); return; }
    const oldSelectedRecordId = currentRecordId;
    currentRecordId = record ? record.id : null;

    if (record && typeof record.id !== 'undefined' && record.id !== null) {
        // ВАЖНО: Убедитесь, что 'RouteLink' - это РЕАЛЬНЫЙ ID вашей колонки-ссылки в Table7!
        const refValue = record.RouteLink;

        console.log("DEBUG: handleGristRecordUpdate: Value of record.RouteLink (refValue):", refValue);
        console.log(`DEBUG: handleGristRecordUpdate: Type of record.RouteLink (refValue): ${typeof refValue}`);

        let extractedRouteId = null;

        if (typeof refValue === 'number') {
            extractedRouteId = refValue;
            console.log("DEBUG: handleGristRecordUpdate: refValue is a number.");
        } else if (typeof refValue === 'object' && refValue !== null && refValue.hasOwnProperty('rowId')) {
            extractedRouteId = refValue.rowId;
            console.log("DEBUG: handleGristRecordUpdate: refValue is an object, extracted rowId:", extractedRouteId);
        } else if (Array.isArray(refValue) && refValue.length === 2 && typeof refValue[0] === 'string' && refValue[0].toUpperCase() === 'L') {
            extractedRouteId = refValue[1];
            console.log("DEBUG: handleGristRecordUpdate: refValue is Grist link array, extracted ID/UUID:", extractedRouteId);
        } else if (typeof refValue === 'string' && refValue.trim() !== "") {
            extractedRouteId = refValue;
            console.log("DEBUG: handleGristRecordUpdate: refValue is a string, using it as is (e.g., for UUID).");
        } else {
            console.warn("DEBUG: handleGristRecordUpdate: refValue for RouteLink is in an unexpected format or null/empty.");
        }

        g_currentRouteActualRefId = extractedRouteId;

        if (g_currentRouteActualRefId !== null && typeof g_currentRouteActualRefId !== 'undefined' && !isNaN(Number(g_currentRouteActualRefId))) {
             g_currentRouteActualRefId = Number(g_currentRouteActualRefId);
        } else if (typeof g_currentRouteActualRefId === 'string' && g_currentRouteActualRefId.trim() === "") {
             g_currentRouteActualRefId = null;
        }
        console.log(`DEBUG: Global g_currentRouteActualRefId set to: ${g_currentRouteActualRefId} (Type: ${typeof g_currentRouteActualRefId})`);

        const lat = record.C; const lng = record.D;
        if (typeof lat === 'number' && typeof lng === 'number' && !isNaN(lat) && !isNaN(lng)) {
            map.flyTo(L.latLng(lat, lng), MARKER_ZOOM_LEVEL);
            if (poiMarkersLayer) {
                poiMarkersLayer.eachLayer(layer => {
                    if (layer.options && layer.options.gristRecordId === record.id) {
                        layer.openPopup();
                        console.log(`DEBUG: Opened popup for marker with Grist ID: ${record.id}`);
                    }
                });
            }
        }
    } else {
        console.log("DEBUG: handleGristRecordUpdate: No valid POI record selected. g_currentRouteActualRefId remains:", g_currentRouteActualRefId);
    }
}

/**
 * Загружает POI, делает их перетаскиваемыми, обновляет Grist при перетаскивании,
 * и устанавливает обработчик клика на маркер для выбора строки в Grist.
 * ВЕРСИЯ #226 - С попыткой grist.requestFocus()
 */
function loadExistingPOIs(records, mappings) {
    console.log("DEBUG: loadExistingPOIs: Called. Received records count:", records ? records.length : 0);
    if (!map || !poiMarkersLayer) { console.warn("DEBUG: loadExistingPOIs: Map or POI layer not ready."); return; }
    poiMarkersLayer.clearLayers();
    console.log("DEBUG: loadExistingPOIs: Previous POI markers cleared.");

    if (records && records.length > 0) {
        let addedCount = 0;
        records.forEach(record => {
            const routeNameFromFormula = record.A; const type = record.B;
            const lat = record.C; const lng = record.D;
            const description = record.G || "";
            let popupText = `<b>Маршрут:</b> ${routeNameFromFormula || "N/A"}<br><b>Тип:</b> ${type || "N/A"}`;
            if (description) { popupText += `<br><b>Описание:</b> ${description}`; }
            popupText += `<br><small>ID точки: ${record.id}</small>`;

            if (typeof lat === 'number' && typeof lng === 'number' && !isNaN(lat) && !isNaN(lng)) {
                const marker = L.marker(L.latLng(lat, lng), { draggable: true, gristRecordId: record.id })
                    .addTo(poiMarkersLayer).bindPopup(popupText);
                addedCount++;

                marker.on('click', async function(e) {
                    const clickedMarker = e.target;
                    const gristId = clickedMarker.options.gristRecordId;
                    console.log(`DEBUG: Map Marker Clicked. Grist Record ID: ${gristId}`);
                    if (gristId === null || typeof gristId === 'undefined') { console.error("DEBUG: Marker click: gristId is invalid."); return; }

                    let tableIdToSelectIn = currentTableId;
                    if (!tableIdToSelectIn && grist.selectedTable && typeof grist.selectedTable.getTableId === 'function') {
                        try {
                            console.log("DEBUG: Marker click: currentTableId not set, trying grist.selectedTable.getTableId()...");
                            tableIdToSelectIn = await grist.selectedTable.getTableId();
                            if (tableIdToSelectIn) { currentTableId = tableIdToSelectIn; console.log(`DEBUG: Marker click: Table ID for selection set to: ${tableIdToSelectIn}`); }
                            else { console.warn("DEBUG: Marker click: grist.selectedTable.getTableId() returned invalid value."); }
                        } catch (err) { console.error("DEBUG: Marker click: Error getting Table ID:", err); }
                    }

                    if (!tableIdToSelectIn) { console.error("DEBUG: Marker click: Cannot set cursor, tableId is unknown."); alert("Не удалось определить таблицу для выбора строки."); return; }

                    console.log(`DEBUG: Marker click: Attempting to set cursor to rowId: ${gristId} in tableId: ${tableIdToSelectIn}`);
                    if (typeof grist.setCursorPos === 'function') {
                        grist.setCursorPos({ rowId: gristId, tableId: tableIdToSelectIn })
                            .then(() => {
                                console.log(`DEBUG: Marker click: Grist cursor POSSIBLY set to rowId: ${gristId} in table ${tableIdToSelectIn} via grist.setCursorPos.`);
                                if (typeof grist.requestFocus === 'function') {
                                    setTimeout(() => {
                                        console.log("DEBUG: Marker click: Requesting Grist focus after setCursorPos and small delay.");
                                        grist.requestFocus();
                                    }, 50);
                                }
                            })
                            .catch(err => {
                                console.error("DEBUG: Marker click: Error via grist.setCursorPos:", err);
                                if (grist.selectedTable?.setCursorPos) {
                                    console.warn("DEBUG: Marker click: Fallback to grist.selectedTable.setCursorPos...");
                                    grist.selectedTable.setCursorPos({ rowId: gristId })
                                        .then(() => {
                                            console.log(`DEBUG: Marker click: Grist cursor set via grist.selectedTable (fallback).`);
                                            if (typeof grist.requestFocus === 'function') {
                                                setTimeout(() => {
                                                    console.log("DEBUG: Marker click: Requesting Grist focus after fallback setCursorPos and small delay.");
                                                    grist.requestFocus();
                                                }, 50);
                                            }
                                        })
                                        .catch(errFallback => console.error("DEBUG: Marker click: Fallback grist.selectedTable.setCursorPos also failed:", errFallback));
                                } else {
                                     console.error("DEBUG: Marker click: grist.selectedTable or its setCursorPos is not available for fallback.");
                                }
                            });
                    } else { console.error("DEBUG: Marker click: grist.setCursorPos function is not available."); alert("Функция выбора строки в Grist недоступна.");}
                });

                marker.on('dragend', async function(event) {
                    const draggedMarker = event.target;
                    const newPosition = draggedMarker.getLatLng();
                    const recordIdToUpdate = draggedMarker.options.gristRecordId;
                    const originalPosition = draggedMarker.options.originalPosition;
                    console.log(`DEBUG: Marker Dragged: ID=${recordIdToUpdate}, NewPos=${newPosition.lat},${newPosition.lng}`);
                    let tableIdToUpdate = currentTableId;
                    if (!tableIdToUpdate && grist.selectedTable?.getTableId) {
                        try { tableIdToUpdate = await grist.selectedTable.getTableId(); if (tableIdToUpdate) currentTableId = tableIdToUpdate; }
                        catch (err) { console.error("DEBUG: Marker Drag: Error getting Table7 ID:", err); if (originalPosition) draggedMarker.setLatLng(originalPosition); return; }
                    }
                    if (recordIdToUpdate && tableIdToUpdate && typeof tableIdToUpdate === 'string') {
                        const updatedData = { 'C': newPosition.lat, 'D': newPosition.lng };
                        const userActions = [['UpdateRecord', tableIdToUpdate, recordIdToUpdate, updatedData]];
                        try {
                            console.log(`DEBUG: Marker Drag: Updating Grist record ${recordIdToUpdate}:`, updatedData);
                            if (!grist.docApi?.applyUserActions) { throw new Error("Grist docApi not available for drag update."); }
                            await grist.docApi.applyUserActions(userActions);
                            console.log(`DEBUG: Marker Drag: Grist record ${recordIdToUpdate} updated.`);
                            draggedMarker.options.originalPosition = newPosition;
                        } catch (error) { console.error(`DEBUG: Marker Drag: Failed to update Grist record ${recordIdToUpdate}:`, error); alert(`Ошибка обновления координат: ${error.message}`); if (originalPosition) draggedMarker.setLatLng(originalPosition); }
                    } else { console.error("DEBUG: Marker Drag: Cannot update - recordId or tableId missing.", { recordIdToUpdate, tableIdToUpdate }); if (originalPosition) draggedMarker.setLatLng(originalPosition); }
                });
                marker.options.originalPosition = L.latLng(lat, lng);
            }
        });
        console.log(`DEBUG: loadExistingPOIs: Loaded ${addedCount} draggable POIs with click handlers.`);
    } else { console.log("DEBUG: loadExistingPOIs: No POIs to load from Grist."); }
}

async function handleMapClick(e) {
    if (!e.latlng) return;
    const lat = e.latlng.lat; const lng = e.latlng.lng;
    const positionLeaflet = e.latlng;
    const poiType = "Точка интереса"; const description = "";
    console.log("DEBUG: handleMapClick: Map area clicked. Current RouteRef ID to use:", g_currentRouteActualRefId, `(Type: ${typeof g_currentRouteActualRefId})`);

    let tableIdToUse = currentTableId;
    if (!tableIdToUse && grist.selectedTable?.getTableId) {
        try { const id = await grist.selectedTable.getTableId(); if (id) tableIdToUse = id; currentTableId = tableIdToUse; }
        catch(err) { console.error("DEBUG: handleMapClick: Error getting Table7 ID:", err); }
    }

    if (g_currentRouteActualRefId === null || typeof g_currentRouteActualRefId === 'undefined') {
        alert("Контекст маршрута не определен. Сначала выберите маршрут в Table1 (чтобы Table7 отфильтровалась) и кликните на существующую точку в Table7 (если она есть), чтобы виджет 'запомнил' текущий маршрут.");
        console.error("DEBUG: handleMapClick: Cannot add POI - g_currentRouteActualRefId is null or undefined.");
        return;
    }
    const routeRefValueForGrist = g_currentRouteActualRefId;

    if (tableIdToUse && typeof tableIdToUse === 'string') {
        // ВАЖНО: Замените 'RouteLink' на РЕАЛЬНЫЙ ID вашей колонки-ссылки в Table7!
        const newRecord = {
            'RouteLink': routeRefValueForGrist,
            'B': poiType, 'C': lat, 'D': lng, 'G': description
        };
        const userActions = [ ['AddRecord', tableIdToUse, null, newRecord] ];
        console.log(`DEBUG: handleMapClick: Attempting to add record to Grist table ${tableIdToUse}:`, JSON.stringify(newRecord));
        try {
            if (!grist.docApi?.applyUserActions) { throw new Error("Grist docApi not available."); }
            await grist.docApi.applyUserActions(userActions);
            console.log(`DEBUG: handleMapClick: New POI record add action sent successfully.`);
        } catch (error) {
            console.error(`DEBUG: handleMapClick: Failed to add record:`, error);
            alert(`Ошибка добавления POI: ${error.message}`);
        }
    } else {
        console.error("DEBUG: handleMapClick: Cannot add record - Table7 ID is unknown.", tableIdToUse);
        alert("Не удалось добавить POI: ID таблицы 'Детали Маршрута' неизвестен.");
    }
}

function updateMarkerOnMap(position, label) {
    // Эта функция сейчас используется в основном для обновления label временного маркера
    // при клике на карту, до того как он будет заменен маркером из Grist.
    // Или для начальной установки маркера из Grist, если не используется poiMarkersLayer.
    // В текущей логике с poiMarkersLayer и loadExistingPOIs, ее роль меньше.
    console.log("DEBUG: updateMarkerOnMap called (mostly for label update on temp click marker).");
     if (!map) return;
     const latLng = L.latLng(position);
     // Если мы управляем одним глобальным маркером (не для POI списка)
     // if (!marker) {
     //     marker = L.marker(latLng, { title: label }).addTo(map);
     //     map.flyTo(latLng, MARKER_ZOOM_LEVEL);
     // } else {
     //     marker.setLatLng(latLng);
     //     if (marker.getElement()) { marker.getElement().title = label; }
     //     if (!map.hasLayer(marker)) { marker.addTo(map); }
     //     map.flyTo(latLng, MARKER_ZOOM_LEVEL);
     // }
     // console.log(`(General) Marker updated/created. Pos: ${latLng.toString()}, Label: "${label}"`);
}

// === БЛОК РУЧНОЙ ИНИЦИАЛИЗАЦИИ LEAFLET ===
function checkLeafletApi() {
    console.log("DEBUG: checkLeafletApi: --- Top of function ---");
    try {
        if (typeof L === 'object' && L !== null && typeof L.map === 'function') {
            console.log("DEBUG: checkLeafletApi: Leaflet (L) is DEFINED and L.map is a function. Calling initMap().");
            initMap();
        } else {
            let leafletStatus = "Leaflet (L) is UNDEFINED.";
            if (typeof L === 'object' && L !== null) { leafletStatus = "Leaflet (L) is an object, but L.map is NOT a function."; }
            else if (typeof L !== 'undefined') { leafletStatus = `Leaflet (L) is of type ${typeof L}, not an object.`; }
            console.warn(`DEBUG: checkLeafletApi: ${leafletStatus} Will retry in 250ms.`);
            setTimeout(checkLeafletApi, 250);
        }
    } catch (e) {
        console.error("DEBUG: checkLeafletApi: !!! ERROR WITHIN checkLeafletApi !!!", e);
        setTimeout(checkLeafletApi, 1000);
    }
    console.log("DEBUG: checkLeafletApi: --- Bottom of function (after if/else or error) ---");
}

// === ТОЧКА ВХОДА ===
console.log("DEBUG: Main script: --- START --- About to call checkLeafletApi for the first time.");
checkLeafletApi();
console.log("DEBUG: Main script: --- END --- grist_map_widget_hiking_poi.js has finished initial synchronous execution.");
// === КОНЕЦ СКРИПТА ===
