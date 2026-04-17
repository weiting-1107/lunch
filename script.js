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
    const mealTypeInput = document.getElementById('meal-type');
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
    const itemHistoryDl = document.getElementById('item-history');
    const restaurantHistoryDl = document.getElementById('restaurant-history');

    // 狀態與資料快取 (對應新的 Apps Script 五大表)
    let memoryOrders = [];
    let memoryUsers = [];
    let memoryRestaurants = [];
    let memoryVotes = [];
    let memoryConfig = {};
    let isSyncing = false; // ★ 新增：防止寫入期間被 10 秒自動刷新覆蓋 UI

    let currentViewDate = new Date();
    const SETTINGS_KEY = 'lunch_settings';
    const CLOUD_CACHE_KEY = 'lunch_cloud_cache'; // ★ 快取雲端資料，讓頁面一開啟即能立刻顯示

    // ★★★ 雲端資料庫與同步設定 ★★★
    const API_URL = "https://script.google.com/macros/s/AKfycbz7W96yP5KcrzwaMwqFuOP6vEn13jWBw-dwrLH16L7cSq4QOlesnJIdJlvjbSwe3fgl/exec";

    // 日期格式標準化工具：將任何格式的日期統一轉為 YYYY-MM-DD
    function normalizeDate(raw) {
        if (!raw) return '';
        // 已經是 YYYY-MM-DD 格式
        if (typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
        // ISO 字串 (含T) 或其他可被 Date 解析的字串
        try {
            const d = new Date(raw);
            if (!isNaN(d.getTime())) {
                // 用 UTC+8 (台灣時區) 來避免時區偏移導致日期少一天
                const local = new Date(d.getTime() + 8 * 60 * 60 * 1000);
                const yyyy = local.getUTCFullYear();
                const mm = String(local.getUTCMonth() + 1).padStart(2, '0');
                const dd = String(local.getUTCDate()).padStart(2, '0');
                return `${yyyy}-${mm}-${dd}`;
            }
        } catch (e) { }
        return String(raw);
    }

    // 時間格式標準化工具：將任何格式的時間統一轉為 HH:MM
    function normalizeTime(raw) {
        if (!raw) return '';
        const str = String(raw);
        // 已經是 HH:MM 格式
        if (/^\d{2}:\d{2}$/.test(str)) return str;

        // 解決 Google Sheets 1899-12-30 日期格式陷阱：從字串直接萃取時間
        const isoMatch = String(str).match(/T(\d{2}):(\d{2})/);
        if (isoMatch) return `${isoMatch[1]}:${isoMatch[2]}`;

        // 嘗試從 Date 字串中提取時間 (處理 Google Sheets 自動轉換日期問題)
        try {
            const d = new Date(str);
            if (!isNaN(d.getTime())) {
                const hh = String(d.getHours()).padStart(2, '0');
                const mm = String(d.getMinutes()).padStart(2, '0');
                return `${hh}:${mm}`;
            }
        } catch (e) { }
        // 嘗試匹配 HH:MM:SS 格式
        const match = String(str).match(/(\d{1,2}):(\d{2})/);
        if (match) return `${match[1].padStart(2, '0')}:${match[2]}`;
        return '';
    }

    async function fetchFromCloud() {
        if (!API_URL.startsWith("http")) return; // 防止未設定時報錯
        if (isSyncing) return; // ★ 如果正在寫入，跳過本次自動刷新，避免畫面閃爍或吃掉剛新增的資料
        try {
            const res = await fetch(API_URL);
            const data = await res.json();
            if (data) {
                // 如果是新版結構 (有 orders 屬性)
                if (data.orders) {
                    memoryOrders = data.orders.map(o => {
                        o.date = normalizeDate(o.date);
                        o.mealType = o.mealType || '午餐';
                        o.price = Number(o.price) || 0;
                        o.paid = o.paid === true || o.paid === 'TRUE';
                        o.cutoffTime = normalizeTime(o.cutoffTime);
                        return o;
                    }).filter(o => o.date);

                    memoryUsers = data.users || [];
                    memoryRestaurants = data.restaurants || [];
                    memoryVotes = (data.votes || []).map(v => {
                        v.date = normalizeDate(v.date);
                        return v;
                    });
                    memoryConfig = {};
                    (data.config || []).forEach(c => { memoryConfig[c.key] = c.value; });

                } else if (Array.isArray(data)) {
                    // 相容舊版陣列
                    memoryOrders = data.map(o => {
                        o.date = normalizeDate(o.date);
                        o.mealType = o.mealType || '午餐';
                        o.price = Number(o.price) || 0;
                        o.paid = o.paid === true || o.paid === 'TRUE';
                        o.cutoffTime = normalizeTime(o.cutoffTime);
                        return o;
                    }).filter(o => o.date);
                }

                // ★★ 儲存快取，下次開啟頁面可立刻顯示，不用等雲端 ★★
                try {
                    localStorage.setItem(CLOUD_CACHE_KEY, JSON.stringify({
                        orders: memoryOrders, users: memoryUsers,
                        restaurants: memoryRestaurants, votes: memoryVotes,
                        config: Object.entries(memoryConfig).map(([key, value]) => ({ key, value }))
                    }));
                } catch (e) { /* 快取失敗無妨 */ }

                updateDatalists();
                updateGrandTotal();
                handleFormState();
                renderVotingSection(); // ★ 新增：每次刷新時更新投票區

                // 若正在瀏覽表格，立刻觸發畫面刷新
                if (!document.getElementById('excel-modal').classList.contains('hidden')) {
                    renderOrders();
                }

                // 動態渲染系統維護畫面 (若開啟的話)
                const settingsModal = document.getElementById('settings-modal');
                if (settingsModal && !settingsModal.classList.contains('hidden')) {
                    renderSettingsTab();
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

    async function saveCloudData(action, dataArray) {
        if (!API_URL.startsWith("http")) return;
        isSyncing = true;
        try {
            await fetch(API_URL, {
                method: 'POST',
                body: JSON.stringify({ action, data: dataArray })
            });
        } catch (err) {
            showToast('雲端儲存失敗', 'error');
        } finally {
            isSyncing = false;
        }
    }

    function saveOrders(orders) {
        memoryOrders = orders;
        updateDatalists();
        saveCloudData("saveOrders", orders);
    }

    function saveUsers(users) {
        memoryUsers = users;
        saveCloudData("saveUsers", users);
        updateDatalists();
        if (typeof renderVotingSection === 'function') renderVotingSection();
    }

    function saveRestaurants(rests) {
        memoryRestaurants = rests;
        saveCloudData("saveRestaurants", rests);
        updateDatalists();
        if (typeof renderVotingSection === 'function') renderVotingSection();
    }

    function saveVotes(votes) {
        memoryVotes = votes;
        saveCloudData("saveVotes", votes);
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

        // 更新人員下拉選單 (從 Users DB)
        const oldName = personNameInput.value;
        const oldVoteName = document.getElementById('vote-person')?.value;
        personNameInput.innerHTML = '<option value="" disabled selected>請選擇您的姓名</option>';
        const votePersonSel = document.getElementById('vote-person');
        if (votePersonSel) votePersonSel.innerHTML = '<option value="" disabled selected>請選擇您的姓名</option>';

        memoryUsers.forEach(u => {
            personNameInput.innerHTML += `<option value="${u.name}">${u.name}</option>`;
            if (votePersonSel) votePersonSel.innerHTML += `<option value="${u.name}">${u.name}</option>`;
        });
        personNameInput.value = oldName || "";
        if (votePersonSel) {
            // ★ 小技巧：如果沒有舊選擇，自動帶入上次用過的名字
            const lastPerson = localStorage.getItem('lunch_last_person');
            votePersonSel.value = oldVoteName || lastPerson || "";
        }

        // 更新餐廳 Datalist (從 Restaurants DB)
        restaurantHistoryDl.innerHTML = '';
        memoryRestaurants.forEach(r => {
            const opt = document.createElement('option');
            opt.value = r.name;
            restaurantHistoryDl.appendChild(opt);
        });

        // 歷史餐點
        const items = [...new Set(orders.map(o => o.item).filter(Boolean))];

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

    // 鎖單檢查 (包含日期與餐期)
    function isSessionLocked(dateStr, mealTypeStr) {
        const todayStr = getTodayString();
        if (dateStr < todayStr) return true; // 過去日期一律鎖死

        if (dateStr === todayStr) {
            const orders = getOrders();
            const sessionOrders = orders.filter(o => o.date === dateStr && o.mealType === mealTypeStr);
            if (sessionOrders.length > 0) {
                const groupCutoff = sessionOrders[0].cutoffTime || cutoffTimeInput.value;
                if (!groupCutoff) return false;

                const now = new Date();
                const hh = String(now.getHours()).padStart(2, '0');
                const mm = String(now.getMinutes()).padStart(2, '0');
                const currentTimeStr = `${hh}:${mm}`;

                if (currentTimeStr >= groupCutoff) return true;
            }
        }
        return false;
    }

    // 處理主表單狀態 (包含解鎖、上鎖、與餐廳名稱鎖定)
    function handleFormState() {
        const selectedDate = orderDateInput.value;
        const selectedMealType = mealTypeInput.value;
        const locked = isSessionLocked(selectedDate, selectedMealType);

        // 餐廳與時間設定鎖定：
        const orders = getOrders();
        const sessionOrders = orders.filter(o => o.date === selectedDate && o.mealType === selectedMealType);
        const anyOrder = sessionOrders.length > 0 ? sessionOrders[0] : null;

        // ★ 如果此餐期已有訂單，同步顯示雲端的餐廳名稱與鎖單時間
        const cutoffDisplay = document.getElementById('cutoff-display');
        if (anyOrder) {
            if (anyOrder.restaurant) {
                restaurantNameInput.value = anyOrder.restaurant;
            }
            // 鎖單時間：雲端值 > 本機設定值 > 預設值，確保一定會顯示
            const syncedCutoff = anyOrder.cutoffTime || getSettings().cutoffTime || '10:30';
            cutoffTimeInput.value = syncedCutoff;

            // ★ 隱藏原生 time input，改用醒目的文字標籤顯示截止時間
            cutoffTimeInput.style.display = 'none';
            cutoffDisplay.textContent = `⏰ ${selectedDate} ${syncedCutoff}`;
            cutoffDisplay.classList.remove('hidden');

            restaurantNameInput.disabled = true;
            restaurantNameInput.title = "今日此餐期已開單，不可更改餐廳";
            restaurantNameInput.style.background = "var(--input-bg)";
            restaurantNameInput.style.color = "var(--text-muted)";

            cutoffTimeInput.disabled = true;
            cutoffTimeInput.title = "今日此餐期已開單，時間規則不可隨意更改";
            cutoffTimeInput.style.background = "var(--input-bg)";
            cutoffTimeInput.style.color = "var(--text-muted)";
            cutoffTimeInput.style.borderBottom = "1px dashed var(--border)";
        } else {
            restaurantNameInput.disabled = false;
            restaurantNameInput.title = "請輸入此餐期要叫的餐廳名稱";
            restaurantNameInput.style.background = "transparent";
            restaurantNameInput.style.color = "var(--text-main)";

            // 恢復原生 time input
            cutoffTimeInput.style.display = '';
            cutoffTimeInput.disabled = false;
            cutoffTimeInput.title = "鎖單時間 (一旦有人訂購即鎖定)";
            cutoffTimeInput.style.background = "transparent";
            cutoffTimeInput.style.color = "var(--text-main)";
            cutoffTimeInput.style.borderBottom = "none";
            cutoffDisplay.classList.add('hidden');
        }

        // 鎖單視覺與按鈕控制
        if (locked) {
            lockedWarning.classList.remove('hidden');
            lockedWarning.textContent = `⚠️ 【${selectedMealType}】已於 ${selectedDate} ${cutoffTimeInput.value} 截止，訂單已鎖定。`;
            orderFormContainer.classList.add('locked-form');
            submitOrderBtn.disabled = true;
            submitOrderBtn.innerHTML = '已截止鎖定';
            submitOrderBtn.style.background = 'var(--text-muted)';
        } else {
            lockedWarning.classList.add('hidden');
            orderFormContainer.classList.remove('locked-form');
            submitOrderBtn.disabled = false;
            submitOrderBtn.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg> 送出訂單';
            submitOrderBtn.style.background = 'var(--primary)';

            // ★ 如果此餐期已有人點餐但還沒超過截止時間，顯示友善提示
            if (anyOrder) {
                lockedWarning.classList.remove('hidden');
                lockedWarning.textContent = `🕐 【${selectedMealType}】已有 ${sessionOrders.length} 人訂餐，截止時間：${selectedDate} ${cutoffTimeInput.value}，餐廳：${anyOrder.restaurant || '未設定'}`;
                lockedWarning.style.background = 'var(--input-bg)';
                lockedWarning.style.borderColor = 'var(--primary)';
                lockedWarning.style.color = 'var(--primary)';
            }
        }
    }

    orderDateInput.addEventListener('change', () => { handleFormState(); renderVotingSection(); });
    mealTypeInput.addEventListener('change', () => { handleFormState(); renderVotingSection(); });
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
        const mealType = mealTypeInput.value;
        const restaurant = restaurantNameInput.value.trim();

        if (isSessionLocked(date, mealType)) {
            showToast("此餐期已鎖定，無法新增訂單！", "error");
            return;
        }

        if (!name || isNaN(price) || price <= 0 || !item || !restaurant) {
            showToast("請確實填寫姓名、餐點、金額，並確定餐廳已填寫！", "error");
            return;
        }

        const newOrder = {
            id: Date.now().toString(),
            date: date,
            mealType: mealType,
            name: name,
            item: item,
            price: price,
            restaurant: restaurant,
            cutoffTime: cutoffTimeInput.value,
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

            if (dayOrders.length === 0) {
                const tr = document.createElement('tr');
                if (dayLabel === '(六)' || dayLabel === '(日)') tr.classList.add('weekend-row');
                tr.innerHTML = `<td>${dateString} <span style="font-size:0.8em; color:var(--text-muted);">${dayLabel}</span></td><td colspan="5" style="text-align:center; color:var(--text-muted); background:var(--input-bg);">無訂餐紀錄</td>`;
                tbody.appendChild(tr);
            } else {
                // 將每日訂單依照 mealType 再次分群
                const mealTypes = [...new Set(dayOrders.map(o => o.mealType || '午餐'))];

                mealTypes.forEach(mType => {
                    const sessionOrders = dayOrders.filter(o => (o.mealType || '午餐') === mType);
                    if (sessionOrders.length === 0) return;

                    const isLocked = isSessionLocked(dateString, mType);
                    let sessionTotal = 0;
                    const sessionRest = sessionOrders.find(o => o.restaurant)?.restaurant || '未指定餐廳';

                    sessionOrders.forEach((order, index) => {
                        sessionTotal += order.price;
                        const tr = document.createElement('tr');
                        if (order.paid) tr.classList.add('row-paid');
                        
                        const isWeekend = dayLabel === '(六)' || dayLabel === '(日)';
                        if (isWeekend) tr.classList.add('weekend-row');

                        if (index === 0) {
                            const dateColor = isWeekend ? 'var(--danger)' : 'inherit';
                            const tdDate = document.createElement('td');
                            tdDate.rowSpan = sessionOrders.length + 1;
                            const mTypeBadge = `<span style="font-size:0.75rem; background:var(--bg-main); padding:0.1rem 0.3rem; border-radius:0.25rem; font-weight:600; color:var(--text-main); margin-left:0.25rem; border: 1px solid var(--border);">${mType}</span>`;
                            tdDate.innerHTML = `<b style="color:${dateColor}">${order.date}</b> <span style="font-size:0.8em; color:${isWeekend ? 'var(--danger)' : 'var(--text-muted)'}; margin-left: 0.25rem;">${dayLabel}</span> ${mTypeBadge}<br><span style="color:var(--primary); font-size:0.9rem; font-weight:600;">${sessionRest}</span>`;
                            tdDate.style.verticalAlign = 'middle';
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
                                mealTypeInput.value = order.mealType || '午餐';

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
                            tdAction.innerHTML = '<span style="font-size:0.8rem;color:var(--border);">鎖定</span>';
                        }
                        tr.appendChild(tdAction);

                        tbody.appendChild(tr);
                    });

                    // 該餐期小計
                    const subTr = document.createElement('tr');
                    subTr.innerHTML = `<td colspan="2" style="text-align:right; color:var(--text-muted); background:var(--input-bg); font-size:0.9rem;">${mType} 小計</td><td class="amount-value" style="font-weight:bold; color:var(--primary); background:var(--input-bg);">$${sessionTotal}</td><td colspan="2" style="background:var(--input-bg);"></td>`;
                    tbody.appendChild(subTr);
                });
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
        table.innerHTML = `<thead><tr><th>日期 / 餐期 / 餐廳</th><th>餐點明細匯總 (唸給老闆聽)</th><th class="amount-col">金額小計</th></tr></thead>`;
        const tbody = document.createElement('tbody');

        weekDates.forEach(({ dateString, dayLabel }) => {
            const dayOrders = allOrders.filter(o => o.date === dateString);
            if (dayOrders.length === 0) return;

            const mealTypes = [...new Set(dayOrders.map(o => o.mealType || '午餐'))];

            mealTypes.forEach(mType => {
                const sessionOrders = dayOrders.filter(o => (o.mealType || '午餐') === mType);
                if (sessionOrders.length === 0) return;

                const sessionRest = sessionOrders.find(o => o.restaurant)?.restaurant || '未指定餐廳';
                let sessionTotal = 0;

                const itemMap = {};
                sessionOrders.forEach(o => {
                    sessionTotal += o.price;
                    const itemName = o.item || '未填寫餐點';
                    if (!itemMap[itemName]) itemMap[itemName] = { count: 0, total: 0 };
                    itemMap[itemName].count++;
                    itemMap[itemName].total += o.price;
                });

                const itemsArr = Object.entries(itemMap).map(([name, data]) => `<div style="padding:0.2rem 0;">⭐ <b>${name}</b> <span style="color:var(--text-muted);">x ${data.count}</span></div>`);

                const mTypeBadge = `<span style="font-size:0.75rem; background:var(--bg-main); padding:0.1rem 0.3rem; border-radius:0.25rem; font-weight:600; color:var(--text-main); margin-left:0.25rem; border: 1px solid var(--border);">${mType}</span>`;

                const isWeekend = dayLabel === '(六)' || dayLabel === '(日)';
                const dateColor = isWeekend ? 'var(--danger)' : 'inherit';
                const tr = document.createElement('tr');
                if (isWeekend) tr.classList.add('weekend-row');
                tr.innerHTML = `
                    <td style="vertical-align:top; width:30%;">
                        <b style="color:${dateColor}">${dateString}</b> <span style="font-size:0.8em; color:${isWeekend ? 'var(--danger)' : 'var(--text-muted)'};">${dayLabel}</span> ${mTypeBadge}<br>
                        <span style="color:var(--primary); font-weight:600; font-size:1.1rem;">${sessionRest}</span>
                    </td>
                    <td style="vertical-align:top;">${itemsArr.join('')}</td>
                    <td class="amount-value" style="vertical-align:top; font-weight:bold; font-size:1.1rem; color:var(--text-main);">$${sessionTotal}</td>
                `;
                tbody.appendChild(tr);
            });
        });

        if (tbody.children.length === 0) {
            tbody.innerHTML = `<tr><td colspan="3" style="text-align:center; color:var(--text-muted); padding: 2rem;">本週無任何訂餐紀錄</td></tr>`;
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
            tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:var(--text-muted); padding: 2rem;">本週無任何訂餐紀錄</td></tr>`;
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
                <td class="amount-value" style="color:var(--text-muted);">$${data.total}</td>
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

    // CSV 匯出邏輯
    exportCsvBtn.addEventListener('click', () => {
        const { weekOrders } = getWeekData(currentViewDate);
        if (weekOrders.length === 0) return alert('本週無資料可匯出');

        let csv = '\uFEFF';

        if (currentActiveTab === 'tab-details') {
            csv += "日期,餐期,餐廳,姓名,餐點名稱,金額,付款狀態\r\n";
            weekOrders.forEach(o => {
                const m = (o.mealType || '午餐').replace(/"/g, '""');
                const r = (o.restaurant || '未指定').replace(/"/g, '""');
                const n = (o.name || '').replace(/"/g, '""');
                const i = (o.item || '').replace(/"/g, '""');
                const p = o.paid ? '已付清' : '未付';
                csv += `"${o.date}","${m}","${r}","${n}","${i}","${o.price}","${p}"\r\n`;
            });
        } else if (currentActiveTab === 'tab-caller') {
            csv += "日期,餐期,餐廳,餐點明細匯總,該餐期總計金額\r\n";
            const sessionMap = {};
            weekOrders.forEach(o => {
                const sKey = `${o.date}_${o.mealType || '午餐'}`;
                if (!sessionMap[sKey]) sessionMap[sKey] = [];
                sessionMap[sKey].push(o);
            });
            Object.values(sessionMap).forEach(sessionOrders => {
                const date = sessionOrders[0].date;
                const mType = (sessionOrders[0].mealType || '午餐').replace(/"/g, '""');
                const restName = (sessionOrders.find(o => o.restaurant)?.restaurant || '未指定').replace(/"/g, '""');
                let sessionTotal = 0;
                const itemMap = {};
                sessionOrders.forEach(o => {
                    sessionTotal += o.price;
                    const item = o.item || '未填寫';
                    if (!itemMap[item]) itemMap[item] = 0;
                    itemMap[item]++;
                });
                const summaryStr = Object.entries(itemMap).map(([k, v]) => `${k} x ${v}`).join(' / ');
                csv += `"${date}","${mType}","${restName}","${summaryStr}","${sessionTotal}"\r\n`;
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

    // === 系統維護 UI (人員、餐廳、設定) ===
    const settingsModal = document.getElementById('settings-modal');
    const settingsBtn = document.getElementById('settings-btn');
    const closeSettingsBtn = document.getElementById('close-settings-btn');
    const settingsTabs = document.querySelectorAll('.settings-tab-btn');
    let activeSettingsTab = 'tab-users';

    if (settingsBtn) settingsBtn.addEventListener('click', () => {
        if (memoryConfig.adminPwd && String(memoryConfig.adminPwd).trim() !== '') {
            const pwd = prompt('為防止誤觸，請輸入管理員密碼：');
            if (pwd === null) return; // User clicked Cancel
            if (pwd !== String(memoryConfig.adminPwd)) {
                showToast('密碼錯誤！無法進入系統維護。', 'error');
                return;
            }
        }
        settingsModal.classList.remove('hidden');
        renderSettingsTab();
    });
    if (closeSettingsBtn) closeSettingsBtn.addEventListener('click', () => {
        settingsModal.classList.add('hidden');
    });

    settingsTabs.forEach(btn => {
        btn.addEventListener('click', (e) => {
            settingsTabs.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            activeSettingsTab = btn.getAttribute('data-tab');
            renderSettingsTab();
        });
    });

    function renderSettingsTab() {
        const container = document.getElementById('settings-dynamic-content');
        if (!container) return;
        let html = '';

        if (activeSettingsTab === 'tab-users') {
            html += `<div style="margin-bottom:1rem;display:flex;gap:0.5rem;"><input type="text" id="new-user-name" class="restaurant-input" placeholder="新增人員姓名"><button id="add-user-btn" class="primary-btn">新增</button></div>`;
            html += `<table class="excel-table"><thead><tr><th>人員名稱</th><th>操作</th></tr></thead><tbody>`;
            memoryUsers.forEach(u => {
                html += `<tr><td>${u.name}</td><td style="text-align:center;"><button class="secondary-btn" style="color:var(--danger);" onclick="deleteUser('${u.id}')">刪除</button></td></tr>`;
            });
            if (memoryUsers.length === 0) html += `<tr><td colspan="2" style="text-align:center;color:var(--text-muted);">尚無人員資料</td></tr>`;
            html += `</tbody></table>`;
        } else if (activeSettingsTab === 'tab-restaurants') {
            const dayNames = ['日', '一', '二', '三', '四', '五', '六'];
            if (window._editingRestaurantId) {
                // ─── 編輯模式 ─────────────────────────────────
                const r = memoryRestaurants.find(r => r.id === window._editingRestaurantId);
                if (r) {
                    const openDaysArr = r.openDays ? r.openDays.split(',').map(d => d.trim()) : ['1', '2', '3', '4', '5'];
                    const dayChecks = dayNames.map((day, i) =>
                        `<label style="display:inline-flex;align-items:center;gap:3px;cursor:pointer;">
                            <input type="checkbox" name="edit-open-day" value="${i}" ${openDaysArr.includes(String(i)) ? 'checked' : ''}> 週${day}
                        </label>`).join('');
                    html += `<div style="background:var(--input-bg);border:1px solid var(--primary);border-radius:0.5rem;padding:1rem;margin-bottom:1rem;">`;
                    html += `<h4 style="margin-top:0;color:var(--primary);">✏️ 編輯：${r.name}</h4>`;
                    html += `<div class="form-group"><label>店名 *</label><input type="text" id="edit-rest-name" class="restaurant-input" value="${r.name || ''}"></div>`;
                    html += `<div class="form-group"><label>電話</label><input type="text" id="edit-rest-phone" class="restaurant-input" placeholder="02-1234-5678" value="${r.phone || ''}"></div>`;
                    html += `<div class="form-group"><label>地址</label><input type="text" id="edit-rest-address" class="restaurant-input" placeholder="台北市..." value="${r.address || ''}"></div>`;
                    html += `<div class="form-group"><label>菜單網址 (選填)</label><input type="text" id="edit-rest-menu" class="restaurant-input" placeholder="https://..." value="${r.menuUrl || ''}"></div>`;
                    html += `<div class="form-group"><label>營業日</label><div style="display:flex;flex-wrap:wrap;gap:0.75rem;margin-top:0.5rem;">${dayChecks}</div></div>`;
                    html += `<div style="display:flex;gap:0.5rem;margin-top:1rem;"><button id="save-edit-rest-btn" class="primary-btn" style="flex:1;">💾 儲存變更</button><button id="cancel-edit-rest-btn" class="secondary-btn">取消</button></div>`;
                    html += `</div>`;
                }
            } else {
                // ─── 新增表單 ─────────────────────────────────
                const newDayChecks = dayNames.map((day, i) =>
                    `<label style="display:inline-flex;align-items:center;gap:3px;cursor:pointer;">
                        <input type="checkbox" name="new-open-day" value="${i}" ${i >= 1 && i <= 5 ? 'checked' : ''}> 週${day}
                    </label>`).join('');
                html += `<div style="background:var(--input-bg);border:1px solid var(--border);border-radius:0.5rem;padding:1rem;margin-bottom:1rem;">`;
                html += `<div style="display:flex;gap:0.5rem;margin-bottom:0.5rem;"><input type="text" id="new-rest-name" class="restaurant-input" placeholder="店名 *" style="flex:2;"><input type="text" id="new-rest-phone" class="restaurant-input" placeholder="電話 (選填)" style="flex:1;"></div>`;
                html += `<input type="text" id="new-rest-address" class="restaurant-input" placeholder="地址 (選填)" style="width:100%;margin-bottom:0.5rem;">`;
                html += `<input type="text" id="new-rest-menu" class="restaurant-input" placeholder="菜單網址 (選填，如 Facebook 或圖片網址)" style="width:100%;margin-bottom:0.5rem;">`;
                html += `<div style="display:flex;flex-wrap:wrap;gap:0.75rem;margin-bottom:0.5rem;">${newDayChecks}</div>`;
                html += `<button id="add-rest-btn" class="primary-btn" style="width:100%;">➕ 新增便當店</button>`;
                html += `</div>`;
                // ─── 列表表格 ─────────────────────────────────
                html += `<table class="excel-table"><thead><tr><th>店名</th><th>電話</th><th>營業日</th><th>操作</th></tr></thead><tbody>`;
                memoryRestaurants.forEach(r => {
                    const openDaysStr = r.openDays
                        ? r.openDays.split(',').map(d => `週${dayNames[parseInt(d.trim())]}`).join(' ')
                        : '週一~五';
                    const menuBtn = r.menuUrl ? `<a href="${r.menuUrl}" target="_blank" title="查看菜單" style="text-decoration:none;font-size:1.2rem;margin-right:8px;">📄</a>` : '';
                    html += `<tr>`;
                    html += `<td>${menuBtn}<strong>${r.name}</strong>${r.address ? `<br><small style="color:var(--text-muted);">${r.address}</small>` : ''}</td>`;
                    html += `<td>${r.phone || '-'}</td>`;
                    html += `<td style="font-size:0.8rem;">${openDaysStr}</td>`;
                    html += `<td style="text-align:center;white-space:nowrap;"><button class="secondary-btn" onclick="editRestaurant('${r.id}')" style="margin-right:4px;">編輯</button><button class="secondary-btn" style="color:var(--danger);" onclick="deleteRestaurant('${r.id}')">刪除</button></td>`;
                    html += `</tr>`;
                });
                if (memoryRestaurants.length === 0) html += `<tr><td colspan="4" style="text-align:center;color:var(--text-muted);">尚無餐廳資料</td></tr>`;
                html += `</tbody></table>`;
            }
        } else if (activeSettingsTab === 'tab-config') {
            const now = new Date();
            const curHH = String(now.getHours()).padStart(2, '0');
            const curMM = String(now.getMinutes()).padStart(2, '0');
            const currentTimeStr = `${curHH}:${curMM}`;

            let storedTime = memoryConfig.voteCutoffTime;
            if (storedTime !== undefined && storedTime !== '') storedTime = normalizeTime(storedTime);

            const currentCutoff = storedTime || currentTimeStr;
            const currentPwd = memoryConfig.adminPwd || '';
            const todayStr = getTodayString();

            html += `<div class="form-group" style="margin-bottom:1rem; padding-bottom:1rem; border-bottom:1px solid var(--border);"><label>預設每天投票截止時間</label>`;
            html += `<input type="time" id="config-vote-time" class="restaurant-input time-input" value="${currentCutoff}"></div>`;

            html += `<div class="form-group" style="margin-bottom:1rem; padding-bottom:1rem; border-bottom:1px solid var(--border);"><label>指定特定日期的投票截止時間 (優先於預設)</label>`;
            html += `<div style="display:flex; gap:0.5rem; margin-bottom:0.5rem;"><input type="date" id="new-cutoff-date" class="restaurant-input time-input" value="${todayStr}"><input type="time" id="new-cutoff-time" class="restaurant-input time-input" value="${currentCutoff}"><button id="add-cutoff-btn" class="primary-btn" style="white-space:nowrap;">新增設定</button></div>`;
            html += `<table class="excel-table"><thead><tr><th>指定日期</th><th>截止時間</th><th>操作</th></tr></thead><tbody>`;

            let hasOverrides = false;
            Object.keys(memoryConfig).forEach(k => {
                if (k.startsWith('cutoff_')) {
                    hasOverrides = true;
                    const dateStr = k.replace('cutoff_', '');
                    const timeStr = normalizeTime(memoryConfig[k]);
                    html += `<tr><td>${dateStr}</td><td>${timeStr}</td><td style="text-align:center;"><button class="secondary-btn" style="color:var(--danger);" onclick="deleteCutoffOverride('${k}')">刪除</button></td></tr>`;
                }
            });
            if (!hasOverrides) html += `<tr><td colspan="3" style="text-align:center; color:var(--text-muted);">無特定日期設定 (皆使用上方預設時間)</td></tr>`;
            html += `</tbody></table></div>`;

            html += `<div class="form-group" style="margin-bottom:1rem;"><label>系統設定密碼防護 (留空代表任何人皆可進來設定)</label>`;
            html += `<input type="text" id="config-admin-pwd" class="restaurant-input" value="${currentPwd}" placeholder="請設定密碼 (選填)"></div>`;
            html += `<button id="save-config-btn" class="primary-btn" style="width:100%;">儲存設定</button>`;
        }

        container.innerHTML = html;

        // Bind events
        if (activeSettingsTab === 'tab-users') {
            document.getElementById('add-user-btn').onclick = () => {
                const n = document.getElementById('new-user-name').value.trim();
                if (n) {
                    const newUsers = [...memoryUsers, { id: 'U' + Date.now(), name: n }];
                    saveUsers(newUsers);
                    renderSettingsTab();
                }
            };
        } else if (activeSettingsTab === 'tab-restaurants') {
            if (window._editingRestaurantId) {
                document.getElementById('save-edit-rest-btn').onclick = () => {
                    const r = memoryRestaurants.find(r => r.id === window._editingRestaurantId);
                    if (!r) return;
                    const newName = document.getElementById('edit-rest-name').value.trim();
                    if (!newName) { showToast('店名不能為空', 'error'); return; }
                    r.name = newName;
                    r.phone = document.getElementById('edit-rest-phone').value.trim();
                    r.address = document.getElementById('edit-rest-address').value.trim();
                    r.menuUrl = document.getElementById('edit-rest-menu').value.trim();
                    const checked = [...document.querySelectorAll('input[name="edit-open-day"]:checked')].map(cb => cb.value);
                    r.openDays = checked.join(',');
                    window._editingRestaurantId = null;
                    saveRestaurants([...memoryRestaurants]);
                    renderSettingsTab();
                    renderVotingSection();
                };
                document.getElementById('cancel-edit-rest-btn').onclick = () => {
                    window._editingRestaurantId = null;
                    renderSettingsTab();
                };
            } else {
                document.getElementById('add-rest-btn').onclick = () => {
                    const n = document.getElementById('new-rest-name').value.trim();
                    if (!n) { showToast('請輸入店名', 'error'); return; }
                    const phone = document.getElementById('new-rest-phone').value.trim();
                    const address = document.getElementById('new-rest-address').value.trim();
                    const menuUrl = document.getElementById('new-rest-menu').value.trim();
                    const checked = [...document.querySelectorAll('input[name="new-open-day"]:checked')].map(cb => cb.value);
                    const newRest = { id: 'R' + Date.now(), name: n, phone, address, openDays: checked.join(','), menuUrl };
                    saveRestaurants([...memoryRestaurants, newRest]);
                    renderSettingsTab();
                    renderVotingSection();
                };
            }
        } else if (activeSettingsTab === 'tab-config') {
            document.getElementById('add-cutoff-btn').onclick = () => {
                const dateVal = document.getElementById('new-cutoff-date').value;
                const timeVal = document.getElementById('new-cutoff-time').value;
                if (!dateVal || !timeVal) {
                    showToast('請完整選取日期與時間', 'error');
                    return;
                }

                // 防呆：禁止設定已過去的時間
                const selectedDateTime = new Date(`${dateVal}T${timeVal}`);
                if (selectedDateTime <= new Date()) {
                    showToast('只能設定未來的時間！', 'error');
                    return;
                }

                const key = 'cutoff_' + dateVal;
                memoryConfig[key] = timeVal;

                const newConfig = [];
                Object.keys(memoryConfig).forEach(k => {
                    let val = memoryConfig[k];
                    if (k === 'voteCutoffTime' || k.startsWith('cutoff_')) val = "'" + normalizeTime(val);
                    newConfig.push({ key: k, value: val });
                });
                saveCloudData("saveConfig", newConfig);
                renderSettingsTab();
                renderVotingSection();
            };

            document.getElementById('save-config-btn').onclick = () => {
                const t = document.getElementById('config-vote-time').value;
                const p = document.getElementById('config-admin-pwd').value;

                memoryConfig.voteCutoffTime = t;
                memoryConfig.adminPwd = p;

                const newConfig = [];
                Object.keys(memoryConfig).forEach(k => {
                    let val = memoryConfig[k];
                    if (k === 'voteCutoffTime' || k.startsWith('cutoff_')) val = "'" + normalizeTime(val);
                    newConfig.push({ key: k, value: val });
                });
                saveCloudData("saveConfig", newConfig);
                renderVotingSection();
                showToast('設定已儲存', 'success');
            };
        }
    }

    window.deleteUser = function (id) {
        if (confirm('確定刪除此人員？')) {
            saveUsers(memoryUsers.filter(u => u.id !== id));
            renderSettingsTab();
        }
    };

    window.editRestaurant = function (id) {
        window._editingRestaurantId = id;
        renderSettingsTab();
    };

    window.deleteRestaurant = function (id) {
        if (confirm('確定刪除此餐廳？')) {
            saveRestaurants(memoryRestaurants.filter(r => r.id !== id));
            renderSettingsTab();
            renderVotingSection();
        }
    };

    window.deleteCutoffOverride = function (key) {
        if (confirm('確定要刪除這個日期的專屬於截止時間嗎？')) {
            const newConfig = [];
            Object.keys(memoryConfig).forEach(k => {
                if (k !== key) {
                    let val = memoryConfig[k];
                    if (k === 'voteCutoffTime' || k.startsWith('cutoff_')) val = "'" + normalizeTime(val);
                    newConfig.push({ key: k, value: val });
                }
            });
            delete memoryConfig[key];
            saveCloudData("saveConfig", newConfig);
            renderSettingsTab();
            renderVotingSection();
        }
    }

    // === 投票系統 UI ===
    function renderVotingSection() {
        const vSec = document.getElementById('voting-section');
        const orderDateInput = document.getElementById('order-date'); // 取得選取的日期
        if (!vSec || !orderDateInput) return;

        const now = new Date();
        const curHH = String(now.getHours()).padStart(2, '0');
        const curMM = String(now.getMinutes()).padStart(2, '0');
        const curTimeStr = `${curHH}:${curMM}`;

        const todayStr = getTodayString();
        const selectedDateStr = orderDateInput.value || todayStr;

        let storedTime = memoryConfig['cutoff_' + selectedDateStr];
        if (storedTime === undefined || storedTime === '') {
            storedTime = memoryConfig.voteCutoffTime;
        }

        if (storedTime !== undefined && storedTime !== '') {
            storedTime = normalizeTime(storedTime);
        }
        const voteCutoff = storedTime || curTimeStr;
        const mType = document.getElementById('meal-type').value || '午餐';

        // 此餐期的現有訂單 (如果有已經建立出來的訂單，表示餐廳已經鎖定了)
        const sessionOrders = memoryOrders.filter(o => o.date === selectedDateStr && (o.mealType || '午餐') === mType);

        // 判斷是否超過開放投票的時間
        // 如果是過去的日期 -> 關閉
        // 如果是今天的日期，且現在時間大於每日開票時間 -> 關閉
        const isPastCutoff = (selectedDateStr < todayStr) || (selectedDateStr === todayStr && curTimeStr >= voteCutoff);

        // 如果現在過了每日投票時間，強制關閉投票並統計
        if (isPastCutoff || sessionOrders.length > 0) {
            vSec.classList.add('hidden');

            // 如果還沒有任何訂單，我們嘗試從此餐期的投票中選出最高分的自動填入餐廳名字
            if (sessionOrders.length === 0) {
                const todaysVotes = memoryVotes.filter(v => v.date === selectedDateStr && v.mealType === mType);
                if (todaysVotes.length > 0) {
                    const counts = {};
                    let maxCount = 0;
                    todaysVotes.forEach(v => {
                        counts[v.restaurantName] = (counts[v.restaurantName] || 0) + 1;
                        if (counts[v.restaurantName] > maxCount) maxCount = counts[v.restaurantName];
                    });

                    // ★ 修改：平手隨機決策
                    const tiedRests = Object.entries(counts)
                        .filter(([name, count]) => count === maxCount)
                        .map(([name]) => name)
                        .sort(); // 排序確保種子選取一致

                    let winner = '';
                    if (tiedRests.length > 1) {
                        // 使用日期+餐期作為種子，讓每個人看到的「隨機」結果是一樣的
                        const seedStr = selectedDateStr + mType;
                        let hash = 0;
                        for (let i = 0; i < seedStr.length; i++) {
                            hash = ((hash << 5) - hash) + seedStr.charCodeAt(i);
                            hash |= 0;
                        }
                        const index = Math.abs(hash) % tiedRests.length;
                        winner = tiedRests[index];
                    } else {
                        winner = tiedRests[0];
                    }

                    if (winner && document.getElementById('restaurant-name').value === '') {
                        document.getElementById('restaurant-name').value = winner;
                    }
                }
            }
            return;
        }

        // 可以顯示投票區
        vSec.classList.remove('hidden');
        document.getElementById('voting-countdown').innerText = `截止時間：${selectedDateStr} ${voteCutoff}`;

        const container = document.getElementById('voting-options');
        container.innerHTML = '';
        const todaysVotes = memoryVotes.filter(v => v.date === selectedDateStr && v.mealType === mType);

        // 算出每家餐廳目前的票數
        const voteCounts = {};
        todaysVotes.forEach(v => voteCounts[v.restaurantName] = (voteCounts[v.restaurantName] || 0) + 1);

        // ★ 只顯示「今天有營業」的餐廳
        const todayDow = new Date().getDay(); // 0=日,1=一...6=六
        const todayDateStr = getTodayString();
        const isToday = (selectedDateStr === todayDateStr);
        const openRestaurants = memoryRestaurants.filter(r => {
            if (!r.openDays || r.openDays.trim() === '') return true; // 未設定→全天開
            const days = r.openDays.split(',').map(d => parseInt(d.trim()));
            // 如果是今天就用今天星期幾判斷；其他日期用選取日期的星期幾
            const targetDate = new Date(selectedDateStr + 'T12:00:00');
            const targetDow = isToday ? todayDow : targetDate.getDay();
            return days.includes(targetDow);
        });
        openRestaurants.forEach(r => {
            const count = voteCounts[r.name] || 0;
            const row = document.createElement('label');
            row.style.cssText = "display:flex; justify-content:space-between; align-items:center; padding:0.5rem; background:var(--card-bg); border-radius:0.25rem; border:1px solid var(--border); cursor:pointer;";
            const menuLink = r.menuUrl ? `<a href="${r.menuUrl}" target="_blank" style="text-decoration:none; font-size:1.1rem; margin-left:8px;" title="查看菜單">📄</a>` : '';
            row.innerHTML = `
                <div style="display:flex; gap:0.5rem; align-items:center;">
                    <input type="radio" name="vote-restaurant-radio" value="${r.name}">
                    <span style="font-weight:500;">${r.name}</span>
                    ${menuLink}
                </div>
                <span class="stat-badge" style="background:var(--primary); color:white;">${count} 票</span>
            `;
            container.appendChild(row);
        });

        // ★ 自動帶入此人上次投票的選擇，讓他知道自己已投過
        const lastPerson = document.getElementById('vote-person').value || localStorage.getItem('lunch_last_person');
        if (lastPerson) {
            const myVote = todaysVotes.find(v => v.userName === lastPerson);
            if (myVote) {
                // 預先勾選此人之前投的餐廳
                const radio = container.querySelector(`input[value="${myVote.restaurantName}"]`);
                if (radio) radio.checked = true;
                // 顯示已投過的提示
                const alreadyVotedNote = document.getElementById('already-voted-note');
                if (alreadyVotedNote) {
                    alreadyVotedNote.textContent = `✅ ${lastPerson} 已投票給『${myVote.restaurantName}』，可再次備選修改`;
                    alreadyVotedNote.style.display = 'block';
                }
            } else {
                const alreadyVotedNote = document.getElementById('already-voted-note');
                if (alreadyVotedNote) alreadyVotedNote.style.display = 'none';
            }
        }

        if (memoryRestaurants.length === 0) {
            container.innerHTML = '<div style="color:var(--text-muted);">尚未建立餐廳名單，請管理員於上方「系統設定」加入。</div>';
        }
    }

    const submitVoteBtn = document.getElementById('submit-vote-btn');
    if (submitVoteBtn) submitVoteBtn.addEventListener('click', () => {
        const person = document.getElementById('vote-person').value;
        const restRadio = document.querySelector('input[name="vote-restaurant-radio"]:checked');

        if (!person) { showToast('請先選擇您的姓名', 'error'); return; }
        if (!restRadio) { showToast('請選擇想要投的餐廳', 'error'); return; }

        // ★ 記住此次選擇的人
        localStorage.setItem('lunch_last_person', person);

        const selectedDateStr = document.getElementById('order-date').value || getTodayString();
        const mType = document.getElementById('meal-type').value || '午餐';

        // 找尋是否有投過了
        let updatedVotes = [...memoryVotes];
        const existingVoteIndex = updatedVotes.findIndex(v => v.date === selectedDateStr && v.mealType === mType && v.userName === person);

        if (existingVoteIndex >= 0) {
            // 取代舊票
            updatedVotes[existingVoteIndex].restaurantName = restRadio.value;
            showToast('已修改您的投票！', 'success');
        } else {
            updatedVotes.push({ date: selectedDateStr, mealType: mType, userName: person, restaurantName: restRadio.value });
            showToast('✅ 投票成功！', 'success');
        }

        saveVotes(updatedVotes);
        renderVotingSection();
    });

    // 監聽重新選餐期以重繪投票
    document.getElementById('meal-type').addEventListener('change', () => {
        renderVotingSection();
        handleFormState();
    });

    // ★ Boot：先從快取立刻繪出畫面，同時非同步抓雲端
    try {
        const cached = JSON.parse(localStorage.getItem(CLOUD_CACHE_KEY));
        if (cached) {
            if (cached.orders) memoryOrders = cached.orders;
            if (cached.users) memoryUsers = cached.users;
            if (cached.restaurants) memoryRestaurants = cached.restaurants;
            if (cached.votes) {
                memoryVotes = cached.votes.map(v => { v.date = normalizeDate(v.date); return v; });
            }
            if (cached.config) {
                memoryConfig = {};
                cached.config.forEach(c => { memoryConfig[c.key] = c.value; });
            }
            updateDatalists();
            handleFormState();
            updateGrandTotal();
            renderVotingSection(); // ★ 用快取立即顯示投票區（0ms！）
        }
    } catch (e) { /* 快取損壞，略過 */ }

    fetchFromCloud(); // 背景抓雲端最新資料（幾秒後更新）
    setInterval(fetchFromCloud, 10000); // 每 10 秒自動同步

    if (!localStorage.getItem(CLOUD_CACHE_KEY)) {
        // 無快取時才做初始 render（有快取的話上面已做過）
        updateDatalists();
        handleFormState();
        updateGrandTotal();
    }

});
