// --- Theme & Toast Logic ---
const theme = localStorage.getItem('lunch_theme') || 'light';
if (theme === 'dark') document.documentElement.setAttribute('data-theme', 'dark');

function showToast(msg, type = 'success') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    const icon = type === 'success' ? '✅' : (type === 'error' ? '⚠️' : '💡');
    toast.innerHTML = `<span>${icon}</span> <span>${msg}</span>`;
    container.appendChild(toast);
    setTimeout(() => {
        toast.classList.add('diminish');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

document.addEventListener('DOMContentLoaded', () => {
    const themeToggleBtn = document.getElementById('theme-toggle-btn');
    if (themeToggleBtn) {
        themeToggleBtn.addEventListener('click', () => {
            const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
            if (isDark) {
                document.documentElement.removeAttribute('data-theme');
                localStorage.setItem('lunch_theme', 'light');
            } else {
                document.documentElement.setAttribute('data-theme', 'dark');
                localStorage.setItem('lunch_theme', 'dark');
            }
        });
    }

    // 綁定 DOM 元素
    const orderDateInput = document.getElementById('order-date');
    const restaurantNameInput = document.getElementById('restaurant-name');
    const cutoffTimeInput = document.getElementById('cutoff-time');

    const personNameInput = document.getElementById('person-name');
    const itemNameInput = document.getElementById('item-name');
    const itemPriceInput = document.getElementById('item-price');
    const submitOrderBtn = document.getElementById('submit-order-btn');
    const orderFormContainer = document.getElementById('order-form-container');
    const lockedWarning = document.getElementById('locked-warning');

    const grandTotalEl = document.getElementById('grand-total');
    const excelModal = document.getElementById('excel-modal');
    const viewExcelBtn = document.getElementById('view-excel-btn');
    const closeModalBtn = document.getElementById('close-modal-btn');
    const exportCsvBtn = document.getElementById('export-csv-btn');
    const clearHistoryBtn = document.getElementById('clear-history-btn');

    const viewPersonBtn = document.getElementById('view-person-btn');

    // 歷史週別導航按鈕
    const prevWeekBtn = document.getElementById('prev-week-btn');
    const nextWeekBtn = document.getElementById('next-week-btn');
    const currentWeekBtn = document.getElementById('current-week-btn');
    const currentWeekLabel = document.getElementById('current-week-label');

    // Tabs
    const tabBtns = document.querySelectorAll('.tab-btn');
    let currentActiveTab = 'tab-details';
    const dynamicTableContainer = document.getElementById('dynamic-table-container');

    // Datalists
    const nameHistoryDl = document.getElementById('name-history');
    const itemHistoryDl = document.getElementById('item-history');

    // 狀態管理
    let currentViewDate = new Date();
    const SETTINGS_KEY = 'lunch_settings';

    // ★★★ 雲端資料庫與同步設定 ★★★
    const API_URL = "https://script.google.com/macros/s/AKfycbz7W96yP5KcrzwaMwqFuOP6vEn13jWBw-dwrLH16L7cSq4QOlesnJIdJlvjbSwe3fgl/exec";
    let memoryOrders = []; // 用於暫存雲端資料

    async function fetchFromCloud() {
        if (!API_URL.startsWith("http")) return; // 防止未設定時報錯
        try {
            const res = await fetch(API_URL);
            const data = await res.json();
            if (Array.isArray(data)) {
                memoryOrders = data;
                updateDatalists();
                updateGrandTotal();

                // 若正在瀏覽表格，立刻觸發畫面刷新
                if (!document.getElementById('excel-modal').classList.contains('hidden')) {
                    renderOrders();
                }
            }
        } catch (err) {
            console.error("雲端同步失敗", err);
        }
    }

    // === Helpers ===
    function getTodayString() {
        const today = new Date();
        const yyyy = today.getFullYear();
        const mm = String(today.getMonth() + 1).padStart(2, '0');
        const dd = String(today.getDate()).padStart(2, '0');
        return `${yyyy}-${mm}-${dd}`;
    }

    function getOrders() {
        return memoryOrders;
    }

    function saveOrders(orders) {
        memoryOrders = orders;
        updateDatalists();

        if (!API_URL.startsWith("http")) {
            console.warn("尚未設置 API_URL，無法同步至雲端");
            return;
        }

        // 覆蓋寫入至 Google Sheets
        fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' }, // 避開 CORS 限制
            body: JSON.stringify(orders)
        }).catch(() => showToast('雲端儲存失敗，請檢查網路連線', 'error'));
    }

    // 將設定維持在 LocalStorage，因為個人設定不需要全公司同步
    function getSettings() {
        try { return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || { cutoffTime: '10:30' }; } catch (e) { return { cutoffTime: '10:30' }; }
    }

    function saveSettings(settings) {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    }

    // 初始化設定
    const initialSettings = getSettings();
    if (initialSettings.cutoffTime) {
        cutoffTimeInput.value = initialSettings.cutoffTime;
    }
    orderDateInput.value = getTodayString();

    // 更新 Datalist 記憶快選
    function updateDatalists() {
        const orders = getOrders();
        const names = [...new Set(orders.map(o => o.name).filter(Boolean))];
        const items = [...new Set(orders.map(o => o.item).filter(Boolean))];

        nameHistoryDl.innerHTML = '';
        names.forEach(n => {
            const opt = document.createElement('option');
            opt.value = n;
            nameHistoryDl.appendChild(opt);
        });

        itemHistoryDl.innerHTML = '';
        items.forEach(i => {
            const opt = document.createElement('option');
            opt.value = i;
            itemHistoryDl.appendChild(opt);
        });

        renderQuickPrices(orders);
    }

    // 動態產生快速價格按鈕
    function renderQuickPrices(orders) {
        const quickContainer = document.getElementById('quick-prices-container');
        if (!quickContainer) return;
        const freq = {};
        orders.forEach(o => { freq[o.price] = (freq[o.price] || 0) + 1; });
        const topPrices = Object.keys(freq).sort((a, b) => freq[b] - freq[a]).slice(0, 4).map(Number);
        // 如果歷史資料不夠，提供預設價格
        const displayPrices = topPrices.length >= 3 ? topPrices : [50, 60, 80, 100];

        quickContainer.innerHTML = '';
        displayPrices.forEach(p => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'quick-price-btn';
            btn.textContent = `+$${p}`;
            btn.addEventListener('click', () => {
                itemPriceInput.value = p;
                itemPriceInput.focus();
            });
            quickContainer.appendChild(btn);
        });
    }

    // 自動帶入上次的餐點價格
    itemNameInput.addEventListener('change', () => {
        const typed = itemNameInput.value.trim();
        if (!typed) return;
        const orders = getOrders();
        const match = orders.slice().reverse().find(o => o.item === typed);
        if (match && !itemPriceInput.value) {
            itemPriceInput.value = match.price;
            showToast(`已自動記憶價格：$${match.price}`, 'info');
        }
    });

    // 鎖單檢查
    function isDateLocked(dateStr) {
        const todayStr = getTodayString();
        if (dateStr < todayStr) return true; // 過去日期一律鎖死

        if (dateStr === todayStr) {
            const cutoffTimeStr = cutoffTimeInput.value;
            if (!cutoffTimeStr) return false;

            const now = new Date();
            const hh = String(now.getHours()).padStart(2, '0');
            const mm = String(now.getMinutes()).padStart(2, '0');
            const currentTimeStr = `${hh}:${mm}`;

            if (currentTimeStr >= cutoffTimeStr) return true;
        }
        return false;
    }

    // 處理主表單狀態 (包含解鎖、上鎖、與餐廳名稱鎖定)
    function handleFormState() {
        const selectedDate = orderDateInput.value;
        const locked = isDateLocked(selectedDate);

        // 鎖單視覺與按鈕控制
        if (locked) {
            lockedWarning.classList.remove('hidden');
            orderFormContainer.classList.add('locked-form');
            submitOrderBtn.disabled = true;
            submitOrderBtn.innerHTML = '已截止鎖定';
            submitOrderBtn.style.background = '#94a3b8';
        } else {
            lockedWarning.classList.add('hidden');
            orderFormContainer.classList.remove('locked-form');
            submitOrderBtn.disabled = false;
            submitOrderBtn.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg> 送出訂單';
            submitOrderBtn.style.background = 'var(--primary)';
        }

        // 餐廳與時間設定鎖定：
        // 如果該日期已經有訂單，表示今日規則已經開跑，帶入並全面禁止修改！
        const orders = getOrders();
        const anyOrderToday = orders.find(o => o.date === selectedDate);

        if (anyOrderToday) {
            if (anyOrderToday.restaurant) {
                restaurantNameInput.value = anyOrderToday.restaurant;
            }
            restaurantNameInput.disabled = true;
            restaurantNameInput.title = "今日已開單，為了防止混淆不可更改餐廳";
            restaurantNameInput.style.background = "#f1f5f9";
            restaurantNameInput.style.color = "#64748b";

            cutoffTimeInput.disabled = true;
            cutoffTimeInput.title = "今日已開單，時間規則不可隨意更改";
            cutoffTimeInput.style.background = "#f1f5f9";
            cutoffTimeInput.style.color = "#64748b";
            cutoffTimeInput.style.borderBottom = "1px dashed #cbd5e1";
        } else {
            // 不隨便清空 restaurantNameInput.value，保持使用者輸入的狀態
            restaurantNameInput.disabled = false;
            restaurantNameInput.title = "請輸入今日要叫的餐廳名稱";
            restaurantNameInput.style.background = "transparent";
            restaurantNameInput.style.color = "var(--text-main)";

            cutoffTimeInput.disabled = false;
            cutoffTimeInput.title = "鎖單時間 (一旦有人訂購即鎖定)";
            cutoffTimeInput.style.background = "transparent";
            cutoffTimeInput.style.color = "var(--text-main)";
            cutoffTimeInput.style.borderBottom = "none";
        }
    }

    orderDateInput.addEventListener('change', handleFormState);
    cutoffTimeInput.addEventListener('change', () => {
        const settings = getSettings();
        settings.cutoffTime = cutoffTimeInput.value;
        saveSettings(settings);
        handleFormState();
        if (!excelModal.classList.contains('hidden')) renderOrders();
    });

    // 新增訂單邏輯
    submitOrderBtn.addEventListener('click', () => {
        const name = personNameInput.value.trim();
        const price = parseFloat(itemPriceInput.value);
        const item = itemNameInput.value.trim();
        const date = orderDateInput.value;
        const restaurant = restaurantNameInput.value.trim();

        if (isDateLocked(date)) {
            showToast("該日期已鎖定，無法新增訂單！", "error");
            return;
        }

        if (!name || isNaN(price) || price <= 0 || !item || !restaurant) {
            showToast("請確實填寫姓名、餐點、金額，並確定今日餐廳已填寫！", "error");
            return;
        }

        const newOrder = {
            id: Date.now().toString(),
            date: date,
            name: name,
            item: item,
            price: price,
            restaurant: restaurant,
            paid: false // 新單預設未付款
        };

        const orders = getOrders();
        orders.push(newOrder);
        saveOrders(orders);

        // 觸發重新檢查狀態 (會讓餐廳欄位上鎖)
        handleFormState();

        personNameInput.value = '';
        itemNameInput.value = '';
        itemPriceInput.value = '';
        personNameInput.focus();

        currentViewDate = new Date(date);
        updateGrandTotal();
        showToast(`訂購成功：${item}`, 'success');
    });

    itemPriceInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') submitOrderBtn.click();
    });

    function deleteOrder(orderId) {
        if (!confirm('確定要刪除這筆紀錄嗎？')) return;
        const orders = getOrders();
        const newOrders = orders.filter(o => o.id !== orderId);
        saveOrders(newOrders);
        handleFormState(); // 如果全刪光了，餐廳欄位會重新解鎖
        renderOrders();
        updateGrandTotal();
    }

    function togglePaid(orderId, isPaid) {
        const orders = getOrders();
        const target = orders.find(o => o.id === orderId);
        if (target) {
            target.paid = isPaid;
            saveOrders(orders);
            renderOrders();
        }
    }

    // Modal 開關與 Tabs
    viewExcelBtn.addEventListener('click', () => {
        excelModal.classList.remove('hidden');
        renderOrders();
    });
    viewPersonBtn.addEventListener('click', () => {
        // 直接開啟收錢總帳表
        tabBtns.forEach(b => b.classList.remove('active'));
        const personTab = document.querySelector('[data-tab="tab-person"]');
        if (personTab) personTab.classList.add('active');
        currentActiveTab = 'tab-person';

        excelModal.classList.remove('hidden');
        renderOrders();
    });
    closeModalBtn.addEventListener('click', () => {
        excelModal.classList.add('hidden');
    });
    excelModal.addEventListener('click', (e) => {
        if (e.target === excelModal) excelModal.classList.add('hidden');
    });

    tabBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            tabBtns.forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            currentActiveTab = e.target.getAttribute('data-tab');
            renderOrders();
        });
    });

    // 週導航
    prevWeekBtn.addEventListener('click', () => {
        currentViewDate.setDate(currentViewDate.getDate() - 7);
        renderOrders();
    });
    nextWeekBtn.addEventListener('click', () => {
        currentViewDate.setDate(currentViewDate.getDate() + 7);
        renderOrders();
    });
    currentWeekBtn.addEventListener('click', () => {
        currentViewDate = new Date();
        renderOrders();
    });

    // 只更新外層的 Total 與今日統計
    function updateGrandTotal() {
        const wt = getWeekData(currentViewDate);
        const gTotal = wt.weekOrders.reduce((acc, cur) => acc + cur.price, 0);
        grandTotalEl.textContent = `$${gTotal}`;

        const todayStr = getTodayString();
        const allOrders = getOrders();
        const todayOrders = allOrders.filter(o => o.date === todayStr);
        const todayTotal = todayOrders.reduce((acc, cur) => acc + cur.price, 0);

        const todayCountEl = document.getElementById('today-count-label');
        const todayTotalEl = document.getElementById('today-total-label');
        if (todayCountEl) todayCountEl.textContent = `${todayOrders.length} 份`;
        if (todayTotalEl) todayTotalEl.textContent = `$${todayTotal}`;
    }

    // 取得指定日期所在的週資料
    function getWeekData(dateObj) {
        const allOrders = getOrders();
        const refDate = new Date(dateObj);
        const currentDay = refDate.getDay();
        const distanceToMonday = currentDay === 0 ? 6 : currentDay - 1;
        const monday = new Date(refDate);
        monday.setDate(refDate.getDate() - distanceToMonday);
        const sunday = new Date(monday);
        sunday.setDate(monday.getDate() + 6);

        const weekDates = [];
        const daysOfWeek = ['(一)', '(二)', '(三)', '(四)', '(五)', '(六)', '(日)'];
        for (let i = 0; i < 7; i++) {
            const d = new Date(monday);
            d.setDate(monday.getDate() + i);
            const y = d.getFullYear();
            const m = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            weekDates.push({ dateString: `${y}-${m}-${day}`, dayLabel: daysOfWeek[i] });
        }

        const formatLabelDate = (d) => `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
        const labelText = `${formatLabelDate(monday)} ~ ${formatLabelDate(sunday)}`;

        const weekOrders = allOrders.filter(o => o.date >= weekDates[0].dateString && o.date <= weekDates[6].dateString);

        return { weekDates, weekOrders, allOrders, labelText };
    }

    function renderOrders() {
        const { weekDates, weekOrders, allOrders, labelText } = getWeekData(currentViewDate);
        currentWeekLabel.textContent = labelText;

        const grandTotal = weekOrders.reduce((sum, o) => sum + o.price, 0);
        grandTotalEl.textContent = `$${grandTotal}`;

        dynamicTableContainer.innerHTML = '';

        if (currentActiveTab === 'tab-details') {
            renderDetailsTable(weekDates, allOrders, grandTotal);
        } else if (currentActiveTab === 'tab-caller') {
            renderCallerTable(weekDates, allOrders);
        } else if (currentActiveTab === 'tab-person') {
            renderPersonTable(weekOrders, grandTotal);
        }
    }

    // === 表格 1：流水記帳表 (Details) ===
    function renderDetailsTable(weekDates, allOrders, grandTotal) {
        const table = document.createElement('table');
        table.className = 'excel-table';
        table.innerHTML = `<thead><tr><th>日期 / 餐廳</th><th>姓名</th><th>餐點</th><th class="amount-col">金額</th><th style="width:50px;">付清</th><th class="action-col">操作</th></tr></thead>`;
        const tbody = document.createElement('tbody');

        weekDates.forEach(({ dateString, dayLabel }) => {
            const dayOrders = allOrders.filter(o => o.date === dateString);
            const isLocked = isDateLocked(dateString);

            if (dayOrders.length === 0) {
                const tr = document.createElement('tr');
                tr.innerHTML = `<td>${dateString} <span style="font-size:0.8em; color:#64748b;">${dayLabel}</span></td><td colspan="5" style="text-align:center; color:#94a3b8; background:#f8fafc;">無訂餐紀錄</td>`;
                tbody.appendChild(tr);
            } else {
                let dayTotal = 0;
                const dailyRest = dayOrders.find(o => o.restaurant)?.restaurant || '未指定餐廳';

                dayOrders.forEach((order, index) => {
                    dayTotal += order.price;
                    const tr = document.createElement('tr');
                    if (order.paid) tr.classList.add('row-paid');

                    if (index === 0) {
                        const tdDate = document.createElement('td');
                        tdDate.rowSpan = dayOrders.length + 1;
                        tdDate.innerHTML = `<b>${order.date}</b> <span style="font-size:0.8em; color:#64748b; margin-left: 0.25rem;">${dayLabel}</span><br><span style="color:var(--primary); font-size:0.9rem; font-weight:600;">${dailyRest}</span>`;
                        tdDate.style.verticalAlign = 'middle';
                        tdDate.style.backgroundColor = '#ffffff';
                        tr.appendChild(tdDate);
                    }

                    tr.innerHTML += `
                        <td>${order.name}</td>
                        <td>${order.item}</td>
                        <td class="amount-value">$${order.price}</td>
                    `;

                    // Paid Checkbox
                    const tdPaid = document.createElement('td');
                    tdPaid.style.textAlign = 'center';
                    const chk = document.createElement('input');
                    chk.type = 'checkbox';
                    chk.className = 'paid-checkbox';
                    chk.checked = order.paid;
                    chk.addEventListener('change', (e) => togglePaid(order.id, e.target.checked));
                    tdPaid.appendChild(chk);
                    tr.appendChild(tdPaid);

                    // 編輯與刪除按鈕
                    const tdAction = document.createElement('td');
                    tdAction.className = 'action-value';
                    tdAction.style.whiteSpace = 'nowrap';
                    if (!isLocked) {
                        const editBtn = document.createElement('button');
                        editBtn.className = 'edit-record-btn';
                        editBtn.title = '修改此紀錄';
                        editBtn.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>';
                        editBtn.addEventListener('click', () => {
                            personNameInput.value = order.name;
                            itemNameInput.value = order.item;
                            itemPriceInput.value = order.price;
                            orderDateInput.value = order.date;

                            excelModal.classList.add('hidden');

                            const orders = getOrders();
                            const newOrders = orders.filter(o => o.id !== order.id);
                            saveOrders(newOrders);
                            handleFormState();
                            renderOrders();
                            updateGrandTotal();
                            personNameInput.focus();
                        });
                        tdAction.appendChild(editBtn);

                        const delBtn = document.createElement('button');
                        delBtn.className = 'delete-record-btn';
                        delBtn.title = '刪除此紀錄';
                        delBtn.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>';
                        delBtn.addEventListener('click', () => deleteOrder(order.id));
                        tdAction.appendChild(delBtn);
                    } else {
                        tdAction.innerHTML = '<span style="font-size:0.8rem;color:#cbd5e1;">鎖定</span>';
                    }
                    tr.appendChild(tdAction);

                    tbody.appendChild(tr);
                });

                // 單日小計
                const subTr = document.createElement('tr');
                subTr.innerHTML = `<td colspan="2" style="text-align:right; color:#64748b; background:#f8fafc; font-size:0.9rem;">單日小計</td><td class="amount-value" style="font-weight:bold; color:var(--primary); background:#f8fafc;">$${dayTotal}</td><td colspan="2" style="background:#f8fafc;"></td>`;
                tbody.appendChild(subTr);
            }
        });

        table.appendChild(tbody);
        const tfoot = document.createElement('tfoot');
        tfoot.innerHTML = `<tr><th colspan="3" class="total-label">本週總計金額</th><th colspan="3" class="modal-total-cell">$${grandTotal}</th></tr>`;
        table.appendChild(tfoot);
        dynamicTableContainer.appendChild(table);
    }

    // === 表格 2：電話叫餐表 (Caller) ===
    function renderCallerTable(weekDates, allOrders) {
        const table = document.createElement('table');
        table.className = 'excel-table';
        table.innerHTML = `<thead><tr><th>日期 / 餐廳</th><th>餐點明細匯總 (唸給老闆聽)</th><th class="amount-col">金額小計</th></tr></thead>`;
        const tbody = document.createElement('tbody');

        weekDates.forEach(({ dateString, dayLabel }) => {
            const dayOrders = allOrders.filter(o => o.date === dateString);
            if (dayOrders.length === 0) return;

            const dailyRest = dayOrders.find(o => o.restaurant)?.restaurant || '未指定餐廳';
            let dayTotal = 0;

            const itemMap = {};
            dayOrders.forEach(o => {
                dayTotal += o.price;
                const itemName = o.item || '未填寫餐點';
                if (!itemMap[itemName]) itemMap[itemName] = { count: 0, total: 0 };
                itemMap[itemName].count++;
                itemMap[itemName].total += o.price;
            });

            const itemsArr = Object.entries(itemMap).map(([name, data]) => `<div style="padding:0.2rem 0;">⭐ <b>${name}</b> <span style="color:#64748b;">x ${data.count}</span></div>`);

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td style="vertical-align:top; width:30%;">
                    <b>${dateString}</b> <span style="font-size:0.8em; color:#64748b;">${dayLabel}</span><br>
                    <span style="color:var(--primary); font-weight:600; font-size:1.1rem;">${dailyRest}</span>
                </td>
                <td style="vertical-align:top;">${itemsArr.join('')}</td>
                <td class="amount-value" style="vertical-align:top; font-weight:bold; font-size:1.1rem; color:#0f172a;">$${dayTotal}</td>
            `;
            tbody.appendChild(tr);
        });

        if (tbody.children.length === 0) {
            tbody.innerHTML = `<tr><td colspan="3" style="text-align:center; color:#94a3b8; padding: 2rem;">本週無任何訂餐紀錄</td></tr>`;
        }

        table.appendChild(tbody);
        dynamicTableContainer.appendChild(table);
    }

    // === 表格 3：收錢總帳表 (Person) ===
    function renderPersonTable(weekOrders, grandTotal) {
        const table = document.createElement('table');
        table.className = 'excel-table';
        table.innerHTML = `<thead><tr><th>姓名</th><th style="text-align:center;">點餐次數</th><th class="amount-col">總花費</th><th class="amount-col">已繳交</th><th class="amount-col">尚欠款</th><th style="width:100px; text-align:center;">狀態</th></tr></thead>`;
        const tbody = document.createElement('tbody');

        const personMap = {};
        weekOrders.forEach(o => {
            if (!personMap[o.name]) personMap[o.name] = { count: 0, total: 0, paidTotal: 0, orderIds: [] };
            personMap[o.name].count++;
            personMap[o.name].total += o.price;
            if (o.paid) personMap[o.name].paidTotal += o.price;
            personMap[o.name].orderIds.push(o.id);
        });

        if (Object.keys(personMap).length === 0) {
            tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:#94a3b8; padding: 2rem;">本週無任何訂餐紀錄</td></tr>`;
        }

        Object.entries(personMap).forEach(([name, data]) => {
            const remains = data.total - data.paidTotal;
            const isAllPaid = remains === 0;

            const tr = document.createElement('tr');
            if (isAllPaid) tr.classList.add('row-paid');

            let statusHtml = '';
            if (isAllPaid) {
                statusHtml = `<div style="color:var(--success);">✅ 已結清</div>`;
            } else {
                statusHtml = `<div style="color:var(--danger); margin-bottom:0.25rem;">❌ 未結清</div>`;
            }

            tr.innerHTML = `
                <td style="font-weight:600; font-size:1.1rem;">${name}</td>
                <td style="text-align:center;">${data.count} 筆</td>
                <td class="amount-value" style="color:#64748b;">$${data.total}</td>
                <td class="amount-value" style="color:var(--success);">$${data.paidTotal}</td>
                <td class="amount-value" style="color:var(--danger); font-weight:700;">$${remains}</td>
                <td class="status-cell" style="text-align:center; font-weight:600; vertical-align:middle;">
                    ${statusHtml}
                </td>
            `;

            // 動態塞入「一鍵結清」按鈕
            if (!isAllPaid) {
                const tdStatus = tr.querySelector('.status-cell');
                const settleBtn = document.createElement('button');
                settleBtn.className = 'settle-all-btn';
                settleBtn.innerText = '💸 一鍵結清';
                settleBtn.title = '結清該人員本週全部欠款';
                settleBtn.addEventListener('click', () => {
                    if (confirm(`確定要將【${name}】本週尚未結清的 $${remains} 欠款全部改為「已付清」嗎？`)) {
                        const allO = getOrders();
                        allO.forEach(o => {
                            if (data.orderIds.includes(o.id) && !o.paid) {
                                o.paid = true;
                            }
                        });
                        saveOrders(allO);
                        renderOrders();
                        showToast(`✅ 已將 ${name} 的欠款全部結清！`);
                    }
                });
                tdStatus.appendChild(settleBtn);
            }

            tbody.appendChild(tr);
        });

        table.appendChild(tbody);
        const tfoot = document.createElement('tfoot');
        tfoot.innerHTML = `<tr><th colspan="2" class="total-label">本週全體總消費</th><th colspan="4" class="modal-total-cell" style="text-align:left; padding-left:1rem;">$${grandTotal}</th></tr>`;
        table.appendChild(tfoot);
        dynamicTableContainer.appendChild(table);
    }

    // CSV 匯出邏輯 (改採真實資料匯出，徹底解決表格 rowspan 導致的跑版問題)
    exportCsvBtn.addEventListener('click', () => {
        const { weekOrders } = getWeekData(currentViewDate);
        if (weekOrders.length === 0) return alert('本週無資料可匯出');

        let csv = '\uFEFF';

        if (currentActiveTab === 'tab-details') {
            csv += "日期,餐廳,姓名,餐點名稱,金額,付款狀態\r\n";
            weekOrders.forEach(o => {
                const r = (o.restaurant || '未指定').replace(/"/g, '""');
                const n = (o.name || '').replace(/"/g, '""');
                const i = (o.item || '').replace(/"/g, '""');
                const p = o.paid ? '已付清' : '未付';
                csv += `"${o.date}","${r}","${n}","${i}","${o.price}","${p}"\r\n`;
            });
        } else if (currentActiveTab === 'tab-caller') {
            csv += "日期,餐廳,餐點明細匯總,當日總計金額\r\n";
            const dateOrders = {};
            weekOrders.forEach(o => {
                if (!dateOrders[o.date]) dateOrders[o.date] = [];
                dateOrders[o.date].push(o);
            });
            Object.keys(dateOrders).forEach(date => {
                const dayOrders = dateOrders[date];
                const restName = (dayOrders.find(o => o.restaurant)?.restaurant || '未指定').replace(/"/g, '""');
                let dayTotal = 0;
                const itemMap = {};
                dayOrders.forEach(o => {
                    dayTotal += o.price;
                    const item = o.item || '未填寫';
                    if (!itemMap[item]) itemMap[item] = 0;
                    itemMap[item]++;
                });
                const summaryStr = Object.entries(itemMap).map(([k, v]) => `${k} x ${v}`).join(' / ');
                csv += `"${date}","${restName}","${summaryStr}","${dayTotal}"\r\n`;
            });
        } else if (currentActiveTab === 'tab-person') {
            csv += "姓名,點餐次數,本週總花費,已繳交,尚欠款,結清狀態\r\n";
            const personMap = {};
            weekOrders.forEach(o => {
                if (!personMap[o.name]) personMap[o.name] = { count: 0, total: 0, paidTotal: 0, orderIds: [] };
                personMap[o.name].count++;
                personMap[o.name].total += o.price;
                if (o.paid) personMap[o.name].paidTotal += o.price;
                personMap[o.name].orderIds.push(o.id);
            });

            Object.entries(personMap).forEach(([name, data]) => {
                const remains = data.total - data.paidTotal;
                const status = remains === 0 ? '已結清' : '未結清';
                csv += `"${name.replace(/"/g, '""')}","${data.count}筆","${data.total}","${data.paidTotal}","${remains}","${status}"\r\n`;
            });
        }

        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.setAttribute('href', url);
        link.setAttribute('download', `訂餐報表_${getTodayString()}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        showToast('✅ 報表匯出成功！', 'success');
    });

    clearHistoryBtn.addEventListener('click', () => {
        const action = prompt('⚠️ 系統大掃除 ⚠️\n\n因為擔心系統日益肥大，這功能能清除舊帳！\n\n輸入「1」：清除 30 天以前的舊紀錄\n輸入「ALL」：徹底刪除整體系統資料 (包含設定！)\n\n請輸入代碼：');

        if (action === '1') {
            const limitDate = new Date();
            limitDate.setDate(limitDate.getDate() - 30);
            const limitStr = limitDate.toISOString().split('T')[0];
            const orders = getOrders();
            const keepOrders = orders.filter(o => o.date >= limitStr);
            const deletedCount = orders.length - keepOrders.length;
            if (deletedCount > 0) {
                saveOrders(keepOrders);
                showToast(`大掃除成功！永久清除了 ${deletedCount} 筆超過 30 天的舊紀錄。`);
                renderOrders();
                updateGrandTotal();
            } else {
                showToast('目前沒有超過 30 天的舊帳需要清除。', 'info');
            }
        } else if (action === 'ALL') {
            if (confirm('🚨 警告：這將會永久清空「所有的訂單」與「個人的歷史設定」，一旦清理就無法還原！\n\n真的確定要全部清空嗎？')) {
                saveOrders([]);
                localStorage.removeItem(SETTINGS_KEY);
                location.reload();
            }
        }
    });

    // Boot
    fetchFromCloud(); // 第一次啟動時抓取雲端資料
    setInterval(fetchFromCloud, 10000); // 每 10 秒自動同步一次最新資料，保持大家畫面一致

    updateDatalists();
    handleFormState();
    updateGrandTotal();

});
