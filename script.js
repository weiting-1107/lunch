// --- Theme & Toast Logic ---
const theme = localStorage.getItem('lunch_theme') || 'light';
if (theme === 'dark') document.documentElement.setAttribute('data-theme', 'dark');

// --- 雲端配置與全域狀態 ---
const API_URL = "https://script.google.com/macros/s/AKfycbyIEYV4Zw1dzGOnuUSukUACow0GDQokNdp3B7-xYi-KS13eDA0aOVGyZtyixHS9h5rf/exec";
const CLOUD_CACHE_KEY = 'lunch_cloud_cache';
const SETTINGS_KEY = 'lunch_settings';

let isSyncing = false;
let lastSaveTimestamp = 0; // 新增：紀錄最後一次儲存時間
let memoryOrders = [];
let memoryUsers = [];
let memoryRestaurants = [];
let memoryVotes = [];
let memoryConfig = {};

// 請求追蹤與狀態
let lastFetchID = 0;
let lastViewedMeal = '';
let lastViewedDate = '';
let currentUser = null; // { name: '', role: 'admin'|'user' }

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

// --- Lightbox 邏輯 (v176) - 移至全域範圍確保可存取 ---
function showMenuLightbox(src, title) {
    let lightbox = document.getElementById('menu-lightbox');
    if (!lightbox) {
        lightbox = document.createElement('div');
        lightbox.id = 'menu-lightbox';
        lightbox.className = 'modal-overlay';
        lightbox.style.zIndex = '3000';
        lightbox.innerHTML = `
            <div class="modal-content" style="max-width:90%; max-height:90%; padding:1.5rem; position:relative; overflow:hidden; display:flex; flex-direction:column;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1rem;">
                    <h3 id="lightbox-title" style="margin:0;"></h3>
                    <button id="close-lightbox" class="close-btn" style="background:none; border:none; font-size:1.5rem; cursor:pointer; color:var(--text-main);">✖</button>
                </div>
                <div style="overflow:auto; flex:1; display:flex; justify-content:center; align-items:flex-start;">
                    <img id="lightbox-img" src="" style="max-width:100%; display:block; border-radius:0.5rem; box-shadow:0 4px 20px rgba(0,0,0,0.3);">
                </div>
            </div>
        `;
        document.body.appendChild(lightbox);
        lightbox.querySelector('#close-lightbox').onclick = () => lightbox.classList.add('hidden');
        lightbox.onclick = (e) => { if (e.target === lightbox) lightbox.classList.add('hidden'); };
    }
    const titleEl = document.getElementById('lightbox-title');
    const imgEl = document.getElementById('lightbox-img');
    if (titleEl) titleEl.innerText = `📄 ${title} 的菜單`;
    if (imgEl) imgEl.src = src;
    lightbox.classList.remove('hidden');
}

// --- 同步指示器控制 ---
function showSyncLoader() {
    document.body.classList.add('sync-active');
}
function hideSyncLoader() {
    document.body.classList.remove('sync-active');
}

document.addEventListener('DOMContentLoaded', () => {
    // --- 核心變數與元素定義 ---
    const appLayout = document.querySelector('.app-layout');
    const excelModal = document.getElementById('excel-modal');
    const settingsModal = document.getElementById('settings-modal');

    // 設定類 Inputs (雙端同步用)
    const dateInputs = document.querySelectorAll('#order-date, #order-date-mob');
    const mealTypeInputs = document.querySelectorAll('#meal-type, #meal-type-mob');
    const restaurantInputs = document.querySelectorAll('#restaurant-name, #restaurant-name-mob');
    const cutoffInputs = document.querySelectorAll('#cutoff-time, #cutoff-time-mob');

    // 其他主要 Input
    const personNameInput = document.getElementById('person-name');
    const itemNameInput = document.getElementById('item-name');
    const itemPriceInput = document.getElementById('item-price');
    const submitOrderBtn = document.getElementById('submit-order-btn');

    const authNameInput = document.getElementById('auth-name');
    const authPassInput = document.getElementById('auth-pass');
    const authSubmitBtn = document.getElementById('auth-submit-btn');
    const authSwitchLink = document.getElementById('auth-switch-link');
    const loginTitle = document.getElementById('login-title');
    const loginSubtitle = document.getElementById('login-subtitle');
    const registerNote = document.getElementById('register-note');
    const loginOverlay = document.getElementById('login-overlay');

    let authMode = 'login'; // 'login' | 'register'
    const orderFormContainer = document.getElementById('order-form-container');
    const lockedWarning = document.getElementById('locked-warning');

    // 定義主輸入框 (解決之前的 ReferenceError 崩潰問題)
    const orderDateInput = document.getElementById('order-date');
    const mealTypeInput = document.getElementById('meal-type');
    const restaurantNameInput = document.getElementById('restaurant-name');
    const cutoffTimeInput = document.getElementById('cutoff-time');

    // Modal UI 變數 (之前被意外刪除)
    const currentWeekLabel = document.getElementById('current-week-label');
    let currentActiveTab = 'tab-details';
    let currentViewDate = new Date();
    let isSettingsAuthenticated = false; // 系統設定驗證狀態

    // 報表導覽按鈕
    const prevWeekBtn = document.getElementById('prev-week-btn');
    const nextWeekBtn = document.getElementById('next-week-btn');
    const currentWeekBtn = document.getElementById('current-week-btn');
    const exportCsvBtn = document.getElementById('export-csv-btn');
    const clearHistoryBtn = document.getElementById('clear-history-btn');

    // === 菜單圖片檢視器 (v242) ===
    window.openMenuViewer = function(restName) {
        const modal = document.getElementById('menu-viewer-modal');
        const img = document.getElementById('menu-viewer-img');
        const title = document.getElementById('menu-viewer-title');
        const empty = document.getElementById('menu-viewer-empty');
        
        if (!modal || !img) return;
        
        const restaurant = memoryRestaurants.find(r => r.name.trim() === restName.trim());
        if (restaurant && restaurant.menuUrl) {
            title.textContent = `🍱 ${restaurant.name} - 菜單`;
            img.src = restaurant.menuUrl; // 這裡直接帶入資料庫抓到的字串
            img.classList.remove('hidden');
            empty.classList.add('hidden');
        } else {
            title.textContent = `🍱 查無菜單`;
            img.src = "";
            img.classList.add('hidden');
            empty.classList.add('hidden');
        }
        
        modal.classList.remove('hidden');
    };

    window.closeMenuViewer = function() {
        const modal = document.getElementById('menu-viewer-modal');
        if (modal) modal.classList.add('hidden');
    };

    // 其他 UI 變數
    const quickOrderLabels = document.getElementById('quick-order-labels');
    const activeRestCard = document.getElementById('active-restaurant-card');
    const displayRestName = document.getElementById('display-rest-name');
    const displayRestMenu = document.getElementById('display-rest-menu');
    const displayRestPhone = document.getElementById('display-rest-phone');
    const restaurantHistoryDl = document.getElementById('restaurant-history');
    const itemHistoryDl = document.getElementById('item-history');

    // 統一綁定輔助函式
    function safeListen(el, event, cb) {
        if (el) el.addEventListener(event, cb);
    }
    function safeListenAll(selector, event, cb) {
        document.querySelectorAll(selector).forEach(el => el.addEventListener(event, cb));
    }

    // --- 狀態同步與 UI 更新 ---
    function syncAndRefresh(inputs, val, refresh = true) {
        inputs.forEach(input => { if (input.value !== val) input.value = val; });
        if (refresh) {
            handleFormState();
            renderVotingSection();
            // v247: 統一呼叫整合後的更新函數
            if (typeof updateRestaurantMenuDisplay === 'function') updateRestaurantMenuDisplay();
        }
    }

    // v247: 已移除舊版的 updateMiniMenuButton 邏輯，統一由 updateRestaurantMenuDisplay 處理


    // 看板元素備忘 (如果有被刪除則不報錯)
    function updateDashboardSafely(stats) {
        const elTodayCount = document.getElementById('dash-today-count');
        const elTodayTotal = document.getElementById('dash-today-total');
        const elGrandTotal = document.getElementById('dash-grand-total');
        if (elTodayCount) elTodayCount.innerText = stats.count || 0;
        if (elTodayTotal) elTodayTotal.innerText = stats.total || 0;
        if (elGrandTotal) elGrandTotal.innerText = stats.grandTotal || '$0';
    }

    // --- 導覽邏輯 ---
    function openDetails() {
        if (tabBtns.length > 0) {
            tabBtns.forEach(b => b.classList.remove('active'));
            const detailTab = document.querySelector('[data-tab="tab-details"]');
            if (detailTab) detailTab.classList.add('active');
        }
        currentActiveTab = 'tab-details';
        if (excelModal) excelModal.classList.remove('hidden');
        if (typeof renderOrders === 'function') renderOrders();
    }

    function openPerson() {
        if (tabBtns.length > 0) {
            tabBtns.forEach(b => b.classList.remove('active'));
            const personTab = document.querySelector('[data-tab="tab-person"]');
            if (personTab) personTab.classList.add('active');
        }
        currentActiveTab = 'tab-person';
        if (excelModal) excelModal.classList.remove('hidden');
        if (typeof renderOrders === 'function') renderOrders();
    }

    function openSettings() {
        if (settingsModal) settingsModal.classList.remove('hidden');
    }

    // 設定項同步
    dateInputs.forEach(el => safeListen(el, 'change', (e) => syncAndRefresh(dateInputs, e.target.value)));
    mealTypeInputs.forEach(el => safeListen(el, 'change', (e) => syncAndRefresh(mealTypeInputs, e.target.value)));
    restaurantInputs.forEach(el => safeListen(el, 'change', (e) => syncAndRefresh(restaurantInputs, e.target.value)));

    // 導航按鈕 (側邊欄與底部同步)
    safeListenAll('.nav-home-btn', 'click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));

    function highlightTab(tabName) {
        currentActiveTab = tabName;
        const allTabs = document.querySelectorAll('.tab-btn');
        allTabs.forEach(b => {
            if (b.getAttribute('data-tab') === tabName) b.classList.add('active');
            else b.classList.remove('active');
        });
    }

    safeListenAll('.nav-details-btn', 'click', () => {
        highlightTab('tab-details');
        excelModal.classList.remove('hidden');
        renderOrders();
    });

    safeListenAll('.nav-person-btn', 'click', () => {
        highlightTab('tab-person');
        excelModal.classList.remove('hidden');
        renderOrders();
    });

    safeListenAll('.nav-settings-btn', 'click', () => {
        if (!settingsModal) return;
        // 直接顯示設定內容 (v223 移除冗餘密碼驗證)
        isSettingsAuthenticated = true;
        document.getElementById('settings-auth-wrapper').style.display = 'none';
        document.getElementById('settings-main-content').style.display = 'block';
        settingsModal.classList.remove('hidden');
        renderSettingsTab(); // 進入後渲染內容
    });

    // 密碼解鎖邏輯
    const unlockSettings = () => {
        const input = document.getElementById('settings-password-input');
        const errorMsg = document.getElementById('auth-error-msg');
        // 強制轉為字串，避免從試算表讀回來時被轉成數字型態導致 === 判斷失敗
        const corePassword = String(memoryConfig.adminPwd || '1234');

        if (input.value === corePassword) {
            isSettingsAuthenticated = true;
            document.getElementById('settings-auth-wrapper').style.display = 'none';
            document.getElementById('settings-main-content').style.display = 'block';
            renderSettingsTab(); // 進入後渲染內容
        } else {
            errorMsg.style.display = 'block';
            input.value = '';
            input.focus();
        }
    };

    safeListen(document.getElementById('unlock-settings-btn'), 'click', unlockSettings);
    safeListen(document.getElementById('settings-password-input'), 'keypress', (e) => {
        if (e.key === 'Enter') unlockSettings();
    });

    // 其他 UI 綁定
    safeListen(personNameInput, 'change', () => { if (typeof updateQuickOrderLabels === 'function') updateQuickOrderLabels(); });
    const updateThemeIcons = (isDark) => {
        document.querySelectorAll('.theme-toggle').forEach(btn => {
            btn.innerHTML = isDark ? '<span>☀️</span>' : '<span>🌙</span>';
        });
    };

    // 初始化圖示狀態
    updateThemeIcons(document.documentElement.getAttribute('data-theme') === 'dark');

    safeListenAll('.theme-toggle', 'click', () => {
        const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
        if (isDark) {
            document.documentElement.removeAttribute('data-theme');
            localStorage.setItem('lunch_theme', 'light');
            updateThemeIcons(false);
        } else {
            document.documentElement.setAttribute('data-theme', 'dark');
            localStorage.setItem('lunch_theme', 'dark');
            updateThemeIcons(true);
        }
    });

    safeListen(document.getElementById('close-modal-btn'), 'click', () => excelModal.classList.add('hidden'));
    safeListen(document.getElementById('close-settings-btn'), 'click', () => settingsModal.classList.add('hidden'));

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
        if (isSyncing) return; // ★ 如果正在寫入，跳過本次自動刷新

        // 紀錄目前的同步狀態
        const currentSyncID = Date.now();
        lastFetchID = currentSyncID;

        // ★ 核心優化：縮短保護時間至 5 秒，配合「即時本地快取」提升反應速度
        const lastSave = parseInt(localStorage.getItem('lunch_last_save') || '0');
        if (Date.now() - lastSave < 5000) return;

        try {
            const res = await fetch(API_URL, {
                method: 'POST',
                body: JSON.stringify({ action: 'fetchData' })
            });

            if (!res.ok) {
                console.error(`[Cloud Sync] 伺服器回傳錯誤: ${res.status}`);
                return;
            }

            const text = await res.text();
            let data;
            try {
                data = JSON.parse(text);
            } catch (e) {
                console.warn("[Cloud Sync] 收到非格式化資料:", text.substring(0, 50));
                return;
            }

            // ★ 核心修復：如果在此期間有新的本地寫入，或是這不是最後一個請求，則捨棄此舊資料
            if (isSyncing || lastFetchID !== currentSyncID) return;

            if (data) {
                // 強制執行資料校正與姓名映射
                if (data.orders) {
                    memoryOrders = data.orders.map(o => {
                        if (!o.name && o.userName) o.name = o.userName;
                        if (o.name && !o.userName) o.userName = o.name;
                        
                        o.date = normalizeDate(o.date);
                        o.mealType = o.mealType || '午餐';
                        o.price = Number(o.price) || 0;
                        o.paid = o.paid === true || o.paid === 'TRUE';
                        o.cutoffTime = normalizeTime(o.cutoffTime);
                        return o;
                    }).filter(o => o.date);

                    memoryUsers = (data.users || []).map(u => {
                        if (!u.name && u.userName) u.name = u.userName;
                        if (u.name && !u.userName) u.userName = u.name;
                        return u;
                    });
                    memoryRestaurants = data.restaurants || [];
                    memoryVotes = (data.votes || []).map(v => {
                        v.date = normalizeDate(v.date);
                        return v;
                    });
                    memoryConfig = {};
                    (data.config || []).forEach(c => { memoryConfig[c.key] = c.value; });

                } else if (Array.isArray(data)) {
                    memoryOrders = data.map(o => {
                        if (!o.name && o.userName) o.name = o.userName;
                        if (o.name && !o.userName) o.userName = o.name;

                        o.date = normalizeDate(o.date);
                        o.mealType = o.mealType || '午餐';
                        o.price = Number(o.price) || 0;
                        o.paid = o.paid === true || o.paid === 'TRUE';
                        o.cutoffTime = normalizeTime(o.cutoffTime);
                        return o;
                    }).filter(o => o.date);
                }

                // ★★ 儲存快取與更新資料相關 UI ★★
                updateLocalCache();
                updateDatalists();
                updateGrandTotal();

                // 若正在瀏覽表格，立刻觸發畫面刷新
                if (!document.getElementById('excel-modal').classList.contains('hidden')) {
                    renderOrders();
                }

                    // 動態渲染系統維護畫面 (若開啟的話)
                    // ★ 修復：如果管理員正在輸入中，跳過自動刷新，避免輸入內容被清空 (v219)
                    const settingsModal = document.getElementById('settings-modal');
                    const isUserTypingInSettings = settingsModal &&
                        !settingsModal.classList.contains('hidden') &&
                        settingsModal.contains(document.activeElement) &&
                        ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName);
                    
                    if (settingsModal && !settingsModal.classList.contains('hidden') && !isUserTypingInSettings) {
                        renderSettingsTab();
                    }
                }

                // ★ 核心優化：無論資料有無異動，每 5 秒都必須執行一次狀態檢查
                handleFormState();
                renderVotingSection();
                toggleRoleUI(); // ★ v226：確保管理員面板隨雲端同步更新下拉選單
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

    // 更新本地快取 (立即同步，解決重整後看到舊資料的問題)
    function updateLocalCache() {
        try {
            localStorage.setItem(CLOUD_CACHE_KEY, JSON.stringify({
                orders: memoryOrders,
                users: memoryUsers,
                restaurants: memoryRestaurants,
                votes: memoryVotes,
                config: Object.entries(memoryConfig).map(([key, value]) => ({ key, value }))
            }));
        } catch (e) { }
    }

    async function saveCloudData(action, dataArray) {
        if (!API_URL.startsWith("http")) return;
        isSyncing = true;
        showSyncLoader(); // ★ 開始存檔

        // --- 偵錯資訊：計算 Payload 大小 ---
        const payload = JSON.stringify({ action, data: dataArray });
        const payloadSize = payload.length;
        console.log(`[Cloud Sync] Action: ${action}, Payload Size: ${payloadSize.toLocaleString()} chars`);

        if (action === "saveRestaurants") {
            const hasImg = dataArray.some(r => r.menuImage);
            const totalImgSize = dataArray.reduce((acc, r) => acc + (r.menuImage ? r.menuImage.length : 0), 0);
            console.log(`[Debug] 餐廳資料包含圖片: ${hasImg ? '是' : '否'}, 圖片總字元數: ${totalImgSize.toLocaleString()}`);

            if (totalImgSize > 500000) {
                console.warn("[Cloud Sync] 警告：圖片資料量極大 (" + totalImgSize + ")，建議縮小圖片或降低品質。");
            }
        }

        try {
            const response = await fetch(API_URL, {
                method: 'POST',
                body: payload
            });

            if (!response.ok) {
                throw new Error(`HTTP Error! Status: ${response.status}`);
            }

            const text = await response.text();
            let result;
            try {
                result = JSON.parse(text);
            } catch (e) {
                // 如果不是 JSON，但文字是 "success"，代表也成功
                if (text.trim() === "success") {
                    return true;
                }
                // 其他非 JSON 文字視為普通訊息
                result = { status: 'info', message: text };
            }

            if (result && result.status === 'error') {
                throw new Error(result.message || '後端回傳錯誤');
            }

            return true; // ★ 成功
        } catch (err) {
            console.error("雲端儲存失敗:", err);
            showToast(`雲端儲存失敗: ${err.message}`, 'error');
            return false; // ★ 失敗
        } finally {
            isSyncing = false;
            hideSyncLoader(); // ★ 存檔結束
            lastSaveTimestamp = Date.now();
            localStorage.setItem('lunch_last_save', lastSaveTimestamp);
        }
    }

    // --- 原子化存檔函式 (解決多人衝突) ---
    function saveOrders(orders, specificAction = "saveOrders", specificData = null) {
        memoryOrders = orders;
        updateDatalists();
        updateLocalCache();

        // 如果有指定特定動作 (如 addOrder)，則只送該筆資料；否則維持 bulk 存檔 (用於清理舊帳)
        const dataToSend = specificData || orders;
        saveCloudData(specificAction, dataToSend);
    }

    function saveUsers(users) {
        // 確保要儲存的資料中，剛註冊的帳號一定有密碼
        const validatedUsers = users.map(u => {
            if (u.name === currentUser?.name && currentUser?.password) {
                u.password = u.password || currentUser.password;
            }
            return u;
        });
        memoryUsers = validatedUsers;
        updateLocalCache();
        saveCloudData("saveUsers", validatedUsers);
        updateDatalists();
        if (typeof renderVotingSection === 'function') renderVotingSection();
    }

    async function saveRestaurants(rests) {
        if (!rests || rests.length === 0) {
            if (memoryRestaurants.length > 0 && !confirm("您確定要刪除所有餐廳資料嗎？")) return;
        }

        showSyncLoader();
        try {
            // 直接儲存資料，由後端處理長字串切片
            memoryRestaurants = rests;
            updateLocalCache();
            const success = await saveCloudData("saveRestaurants", rests);
            if (success) {
                updateDatalists();
                renderVotingSection();
            }
        } catch (err) {
            console.error("餐廳儲存流程中斷:", err);
            showToast(err.message, 'error');
        } finally {
            hideSyncLoader();
        }
    }

    async function saveVotes(votes, singleVoteObj = null) {
        memoryVotes = votes;
        updateLocalCache();
        if (singleVoteObj) {
            return await saveCloudData("submitVote", singleVoteObj);
        } else {
            return await saveCloudData("saveVotes", votes);
        }
    }

    // 將設定維持在 LocalStorage，因為個人設定不需要全公司同步
    function getSettings() {
        const defaultCutoffs = {
            '早餐': '09:00',
            '午餐': '11:00',
            '下午茶': '15:30',
            '晚餐': '18:00',
            '宵夜': '22:30'
        };
        try {
            const s = JSON.parse(localStorage.getItem(SETTINGS_KEY));
            return {
                mealCutoffs: s?.mealCutoffs || defaultCutoffs,
                cutoffTime: s?.cutoffTime || '10:30' // 舊版相容
            };
        } catch (e) {
            return { mealCutoffs: defaultCutoffs, cutoffTime: '10:30' };
        }
    }

    function saveSettings(settings) {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    }

    // 初始化設定
    const initialSettings = getSettings();
    if (initialSettings.cutoffTime) {
        cutoffInputs.forEach(input => { if (input) input.value = initialSettings.cutoffTime; });
    }
    dateInputs.forEach(input => { if (input) input.value = getTodayString(); });

    // ★ 根據目前時間自動選擇預設餐期
    function getCurrentMealPeriod() {
        const now = new Date();
        const h = now.getHours();
        if (h >= 6 && h < 10) return '早餐';
        if (h >= 10 && h < 13) return '午餐';
        if (h >= 13 && h < 16) return '下午茶';
        if (h >= 16 && h < 21) return '晚餐';
        return '宵夜'; // 21:00 ~ 06:00
    }

    (function setDefaultMealType() {
        const defaultMeal = getCurrentMealPeriod();
        document.querySelectorAll('#meal-type, #meal-type-mob').forEach(sel => {
            if (sel) sel.value = defaultMeal;
        });
    })();

    // 更新 Datalist 記憶快選
    function updateDatalists() {
        const orders = getOrders();

        // 更新人員下拉選單 (從 Users DB + 當前登入者)
        if (personNameInput) {
            const oldName = personNameInput.value;
            const votePersonSel = document.getElementById('vote-person');
            const currentVoteVal = votePersonSel ? votePersonSel.value : "";
            
            const baseHtml = '<option value="" disabled selected>請選擇姓名</option>';
            personNameInput.innerHTML = baseHtml;
            if (votePersonSel) votePersonSel.innerHTML = baseHtml;

            // 取得所有不重複的人員名單 (DB + 當前登入者)
            const allNames = [...new Set([
                ...memoryUsers.map(u => u.name),
                ...(currentUser ? [currentUser.name] : [])
            ])].filter(Boolean);

            allNames.forEach(name => {
                const opt = `<option value="${name}">${name}</option>`;
                personNameInput.innerHTML += opt;
                if (votePersonSel) votePersonSel.innerHTML += opt;
            });

            // 針對非管理員：強制帶入姓名並鎖定
            const isAdmin = currentUser && currentUser.role === 'admin';
            if (currentUser && !isAdmin) {
                personNameInput.value = currentUser.name;
                personNameInput.disabled = true;
                if (votePersonSel) {
                    votePersonSel.value = currentUser.name;
                    votePersonSel.disabled = true;
                }
            } else {
                personNameInput.value = oldName || "";
                personNameInput.disabled = false;
                if (votePersonSel) {
                    votePersonSel.value = currentVoteVal || localStorage.getItem('lunch_last_person') || "";
                    votePersonSel.disabled = false;
                }
            }
        }

        // 更新餐廳下拉選單 (從 Restaurants DB)
        if (restaurantInputs && restaurantInputs.length > 0) {
            restaurantInputs.forEach(sel => {
                const oldVal = sel.value;
                sel.innerHTML = '<option value="">請選擇餐廳...</option>';
                memoryRestaurants.forEach(r => {
                    const opt = document.createElement('option');
                    opt.value = r.name;
                    opt.textContent = r.name;
                    sel.appendChild(opt);
                });
                sel.value = oldVal;
            });
        }

        // 歷史餐點
        if (itemHistoryDl) {
            const items = [...new Set(orders.map(o => o.item).filter(Boolean))];
            itemHistoryDl.innerHTML = '';
            items.forEach(i => {
                const opt = document.createElement('option');
                opt.value = i;
                itemHistoryDl.appendChild(opt);
            });
        }

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

    // ★ 新增：每秒更新系統時間顯示與自動檢查餐期跳轉
    setInterval(() => {
        const now = new Date();
        const timeStr = now.toLocaleTimeString('zh-TW', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
        const timeDisplay = document.getElementById('current-system-time');
        if (timeDisplay) timeDisplay.innerText = `🕒 ${timeStr}`;

        // 檢查是否需要自動切換餐期 (若目前選取的餐期已鎖定且時間已進入下一餐)
        autoCheckMealSwitch();
    }, 1000);

    function autoCheckMealSwitch() {
        const todayStr = getTodayString();
        if (orderDateInput.value !== todayStr) return; // ★ 修正：只有在選擇「今天」時才自動切換餐期

        const currentSelected = document.getElementById('meal-type')?.value;
        const recommended = getCurrentMealPeriod();
        if (currentSelected && currentSelected !== recommended) {
            // 如果目前的餐期已經鎖定，就自動跳轉到推薦的下一餐
            if (isSessionLocked(todayStr, currentSelected)) {
                document.querySelectorAll('#meal-type, #meal-type-mob').forEach(sel => {
                    if (sel) {
                        sel.value = recommended;
                        // 觸發變更事件以刷新 UI
                        sel.dispatchEvent(new Event('change'));
                    }
                });
                showToast(`🕛 時間已過，已自動切換至【${recommended}】`, 'info');
            }
        }
    }

    // 鎖單檢查 (包含日期、餐期順序與截止時間)
    function isSessionLocked(dateStr, mealTypeStr) {
        const todayStr = getTodayString();
        if (dateStr < todayStr) return true; // 過去日期一律鎖死

        if (dateStr === todayStr) {
            // 1. 餐期順序檢查 (如果現在已經是後續餐期，則前面的餐期自動鎖定)
            const mealOrder = ['早餐', '午餐', '下午茶', '晚餐', '宵夜'];
            const currentPeriod = getCurrentMealPeriod();
            const selectedIdx = mealOrder.indexOf(mealTypeStr);
            const currentIdx = mealOrder.indexOf(currentPeriod);
            if (selectedIdx < currentIdx) return true;

            // 2. 截止時間檢查
            const settings = getSettings();
            const mealDefault = settings.mealCutoffs[mealTypeStr] || settings.cutoffTime || '10:30';

            const orders = getOrders();
            const sessionOrders = orders.filter(o => o.date === dateStr && o.mealType === mealTypeStr);

            // 核心邏輯：優先使用已開單的時間，若無訂單則使用該餐期的系統預設時間
            // 避免因為抓到 UI 殘留的舊資料 (例如午餐的 10:30) 導致誤鎖
            let activeCutoff = mealDefault;
            if (sessionOrders.length > 0 && sessionOrders[0].cutoffTime) {
                activeCutoff = sessionOrders[0].cutoffTime;
            }

            const now = new Date();
            const hh = String(now.getHours()).padStart(2, '0');
            const mm = String(now.getMinutes()).padStart(2, '0');
            const currentTimeStr = `${hh}:${mm}`;

            if (currentTimeStr >= normalizeTime(activeCutoff)) return true;
        }
        return false;
    }

    // ★ 核心邏輯：計算建議/勝選餐廳 (v197)
    // adminOnly=true 時，跳過投票結果，只回傳管理員設定的預設餐廳
    function getRecommendedRestaurant(date, mealType, adminOnly = false) {
        const orders = getOrders();
        const sessionOrders = orders.filter(o => o.date === date && o.mealType === mealType);

        // 1. 優先權最高：已有人下單
        if (!adminOnly && sessionOrders.length > 0) {
            return { name: sessionOrders[0].restaurant, source: 'order' };
        }

        // 2. 優先權次之：管理員特定日期預定
        const cloudRest = memoryConfig[`restaurant_${date}_${mealType}`];
        if (cloudRest) {
            return { name: cloudRest, source: 'cloud' };
        }

        // 3. 投票結果 (adminOnly 時跳過)
        if (!adminOnly) {
            const todaysVotes = memoryVotes.filter(v => v.date === date && v.mealType === mealType);
            if (todaysVotes.length > 0) {
                const counts = {};
                let maxCount = 0;
                todaysVotes.forEach(v => {
                    counts[v.restaurantName] = (counts[v.restaurantName] || 0) + 1;
                    if (counts[v.restaurantName] > maxCount) maxCount = counts[v.restaurantName];
                });
                const tiedRests = Object.entries(counts).filter(e => e[1] === maxCount).map(e => e[0]).sort();
                const seedStr = date + mealType;
                let hash = 0;
                for (let i = 0; i < seedStr.length; i++) hash = ((hash << 5) - hash) + seedStr.charCodeAt(i);
                const winner = tiedRests[Math.abs(hash | 0) % tiedRests.length];
                return { name: winner, source: 'vote' };
            }
        }

        // 4. Fallback：每週排餐 (作為預設建議) (v228 支援多餐期設定)
        const dow = new Date(date + 'T12:00:00').getDay();
        const dowNum = (dow === 0 ? 7 : dow);
        const weeklyKey = `weekly_${mealType}_${dowNum}`;
        const oldWeeklyKey = `weekly_${dowNum}`; // 向後相容舊版
        const weeklyRest = memoryConfig[weeklyKey] || (mealType === '午餐' ? memoryConfig[oldWeeklyKey] : '') || '';
        if (weeklyRest) return { name: weeklyRest, source: 'weekly' };

        return { name: '', source: 'none' };
    }

    function getActiveCutoffTime() {
        const c1 = document.getElementById('cutoff-time');
        const c2 = document.getElementById('cutoff-time-mob');
        // 判斷哪個輸入框是真正可見且在被使用的
        if (c1 && c1.offsetParent !== null) return c1.value;
        if (c2 && c2.offsetParent !== null) return c2.value;
        // 如果都不可見，嘗試抓取非空的那個，或是回傳預設值
        return (c1 ? c1.value : (c2 ? c2.value : '10:30')) || '10:30';
    }

    // 處理主表單狀態 (包含解鎖、上鎖、與餐廳名稱鎖定)
    function handleFormState() {
        if (!orderDateInput || !mealTypeInput) return;

        const selectedDate = orderDateInput.value;
        const selectedMealType = mealTypeInput.value;

        // ★ 核心優化：判定是否為「新切換」的餐期或日期
        const isSessionChanged = (selectedDate !== lastViewedDate || selectedMealType !== lastViewedMeal);
        const sessionOrders = getOrders().filter(o => o.date === selectedDate && o.mealType === selectedMealType);
        const anyOrder = sessionOrders.length > 0;

        // ★ 核心優化：先更新 UI 的預設時間，再進行鎖單判定
        const settings = getSettings();

        // 優先讀取雲端指定的餐廳與時間設定
        const sessionKey = `${selectedDate}_${selectedMealType}`;
        const cloudRest = memoryConfig[`restaurant_${sessionKey}`];
        const cloudCutoff = memoryConfig[`cutoff_${sessionKey}`];

        const mealDefault = cloudCutoff || settings.mealCutoffs[selectedMealType] || settings.cutoffTime || '10:30';

        if (isSessionChanged && !anyOrder) {
            cutoffInputs.forEach(input => {
                if (input) input.value = mealDefault;
            });
        }

        const isTimeUp = isSessionLocked(selectedDate, selectedMealType);
        const currentOrderCutoff = getActiveCutoffTime();

        // 計算投票截止時間 (鎖單前 15 分鐘)
        const [h, m] = currentOrderCutoff.split(':').map(Number);
        let totalMins = h * 60 + m - 15;
        if (totalMins < 0) totalMins = 0;
        const vH = String(Math.floor(totalMins / 60)).padStart(2, '0');
        const vM = String(totalMins % 60).padStart(2, '0');
        const voteCutoff = `${vH}:${vM}`;

        const now = new Date();
        const curTimeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
        const todayStr = getTodayString();
        
        // 判斷是否已過投票時間
        const isVoteTimeUp = (selectedDate < todayStr) || (selectedDate === todayStr && curTimeStr >= voteCutoff);

        // 只有時間到了才是真正的「全域鎖定」
        const locked = isTimeUp;
        // 如果有人點餐、或鎖單時間到、或「投票時間已過」，就鎖定餐廳輸入
        const settingsLocked = isTimeUp || anyOrder || isVoteTimeUp;

        // ★ 統一計算建議餐廳 (v197)
        const recommendation = getRecommendedRestaurant(selectedDate, selectedMealType);
        const winner = recommendation.name;

        // v239：一般使用者的餐廳輸入框永遠唯讀，依據投票狀態顯示
        let displayWinner = '待定...';
        if (anyOrder || isTimeUp) {
            displayWinner = winner;
        } else if (isVoteTimeUp) {
            const adminRec = getRecommendedRestaurant(selectedDate, selectedMealType, true /*adminOnly*/);
            displayWinner = adminRec.name || '待定...';
        }
        
        restaurantInputs.forEach(input => {
            input.value = displayWinner;
            input.disabled = true;
            input.title = displayWinner === '待定...' ? "投票進行中" : "今日餐廳已定案";
            input.style.background = "var(--input-bg)";
            input.style.color = displayWinner === '待定...' ? "var(--text-muted)" : "var(--text-main)";
        });

        if (settingsLocked) {

            // ★ 關鍵修正：如果只是時間到 (isTimeUp) 但「還沒有人點餐」，允許修改時間來解除鎖定
            const canEditTime = !anyOrder;

            cutoffInputs.forEach(input => {
                input.value = anyOrder ? (sessionOrders[0].cutoffTime || currentOrderCutoff) : currentOrderCutoff;
                input.disabled = !canEditTime;
                input.title = anyOrder ? "已有訂單，不可更改鎖單時間" : (isTimeUp ? "時間已過，請調整時間以解鎖" : "鎖單時間");
                input.style.background = canEditTime ? "transparent" : "var(--input-bg)";
                input.style.color = canEditTime ? "var(--text-main)" : "var(--text-muted)";
            });

            // 鎖定「確定」按鈕 (僅在有人點餐時真正鎖死)
            const confirmCutoffBtns = document.querySelectorAll('#confirm-cutoff-btn, #confirm-cutoff-mob-btn');
            confirmCutoffBtns.forEach(btn => {
                const shouldDisable = anyOrder; // 只有有人點餐才禁用
                // 只有在狀態需要改變時才去觸發 DOM 更新，避免干擾
                if (btn.disabled === shouldDisable && btn.innerHTML === (shouldDisable ? '🔒 鎖定' : '確定')) return;

                btn.disabled = shouldDisable;
                btn.innerHTML = shouldDisable ? '🔒 鎖定' : '確定';
                btn.style.background = shouldDisable ? 'var(--input-bg)' : 'var(--primary)';
                btn.style.color = shouldDisable ? 'var(--text-muted)' : '';
                btn.style.borderColor = shouldDisable ? 'var(--border)' : '';
                btn.style.cursor = shouldDisable ? 'not-allowed' : 'pointer';
            });
        } else {
            // (餐廳輸入框的更新邏輯已經移到 if (settingsLocked) 區塊之前統一處理)

            cutoffInputs.forEach(input => {
                if (isSessionChanged) input.value = mealDefault;
                input.disabled = false;
                input.title = "鎖單時間 (一旦有人訂購即鎖定)";
                input.style.background = "transparent";
                input.style.color = "var(--text-main)";
            });

            // 恢復「確定」按鈕
            const confirmCutoffBtns = document.querySelectorAll('#confirm-cutoff-btn, #confirm-cutoff-mob-btn');
            confirmCutoffBtns.forEach(btn => {
                if (!btn.disabled && btn.innerHTML === '確定') return;
                btn.disabled = false;
                btn.innerHTML = '確定';
                btn.style.background = 'var(--primary)';
                btn.style.color = '';
                btn.style.borderColor = '';
                btn.style.cursor = 'pointer';
            });
        }
        
        // v247：確保每次狀態變更後，都重新刷新菜單按鈕的連結與顯示狀態
        if (typeof updateRestaurantMenuDisplay === 'function') updateRestaurantMenuDisplay();

        // 鎖單視覺與按鈕控制
        if (locked) {
            if (lockedWarning) {
                lockedWarning.classList.remove('hidden');
                const menuLink = getMenuLinkHtml(anyOrder ? anyOrder.restaurant : (restaurantNameInput ? restaurantNameInput.value : ''));

                // 判斷鎖定原因，讓訊息更精確
                const currentPeriod = getCurrentMealPeriod();
                const mealOrder = ['早餐', '午餐', '下午茶', '晚餐', '宵夜'];
                const selectedIdx = mealOrder.indexOf(selectedMealType);
                const currentIdx = mealOrder.indexOf(currentPeriod);

                let lockReason = '';
                const todayStr = getTodayString();
                if (selectedDate < todayStr) {
                    lockReason = '日期已過';
                } else if (selectedDate === todayStr && selectedIdx < currentIdx) {
                    lockReason = `目前已進入【${currentPeriod}】時段`;
                } else {
                    lockReason = `已超過截止時間 ${getActiveCutoffTime()}`;
                }

                lockedWarning.innerHTML = `⚠️ 【${selectedMealType}】訂單已鎖定（${lockReason}）。${menuLink}`;
            }
            if (orderFormContainer) orderFormContainer.classList.add('locked-form');
            if (submitOrderBtn) {
                submitOrderBtn.disabled = true;
                submitOrderBtn.innerHTML = '🔒 已鎖定';
                submitOrderBtn.style.background = 'var(--locked-bg)';
            }
        } else {
            if (lockedWarning) lockedWarning.classList.add('hidden');
            if (orderFormContainer) orderFormContainer.classList.remove('locked-form');
            if (submitOrderBtn) {
                submitOrderBtn.disabled = false;
                submitOrderBtn.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg> 送出訂單';
                submitOrderBtn.style.background = 'var(--primary)';
            }

            // ★ 如果此餐期已有人點餐但還沒超過截止時間，顯示友善提示
            if (anyOrder && lockedWarning) {
                lockedWarning.classList.remove('hidden');
                const menuLink = getMenuLinkHtml(sessionOrders[0].restaurant);
                lockedWarning.innerHTML = `🕐 【${selectedMealType}】已有 ${sessionOrders.length} 人訂餐，截止時間：${selectedDate} ${currentOrderCutoff}</br>餐廳：${sessionOrders[0].restaurant || '未設定'} ${menuLink}`;
                lockedWarning.style.background = 'var(--input-bg)';
                lockedWarning.style.borderColor = 'var(--primary)';
                lockedWarning.style.color = 'var(--primary)';
            }
        }
        // ★ 使用 getOrders() 確保拿到最新訂單，再判斷是否隱藏投票區
        const latestOrders = getOrders();
        const latestSessionOrders = latestOrders.filter(o => o.date === selectedDate && o.mealType === selectedMealType);
        if (latestSessionOrders.length > 0) {
            const vSec = document.getElementById('voting-section');
            if (vSec) vSec.classList.add('hidden');
        } else {
            renderVotingSection();
        }

        // v248: 安全呼叫更新函數
        if (typeof updateRestaurantMenuDisplay === 'function') {
            updateRestaurantMenuDisplay();
        }
        
        if (typeof updateActiveRestaurantCard === 'function') {
            updateActiveRestaurantCard();
        }

        // 紀錄最後瀏覽狀態
        lastViewedDate = selectedDate;
        lastViewedMeal = selectedMealType;
    }

    function updateActiveRestaurantCard() {
        const restName = (restaurantNameInput && restaurantNameInput.value) ? restaurantNameInput.value.trim() : '';
        if (!activeRestCard) return;

        if (!restName) {
            activeRestCard.classList.add('hidden');
            return;
        }

        const restaurant = memoryRestaurants.find(r => r && r.name && r.name.trim() === restName);
        activeRestCard.classList.remove('hidden');
        if (displayRestName) displayRestName.textContent = restName;

        if (displayRestMenu) {
            if (restaurant && restaurant.menuUrl) {
                displayRestMenu.href = restaurant.menuUrl;
                displayRestMenu.style.display = 'flex';
            } else {
                displayRestMenu.style.display = 'none';
            }
        }

        // v245：更新管理員面板的菜單按鈕
        const adminRestMenu = document.getElementById('admin-display-rest-menu');
        const adminRestSelect = document.getElementById('admin-restaurant-name');
        if (adminRestMenu && adminRestSelect) {
            const adminRestName = adminRestSelect.value.trim();
            const adminRestObj = memoryRestaurants.find(r => r && r.name && r.name.trim() === adminRestName);
            if (adminRestObj && adminRestObj.menuUrl) {
                adminRestMenu.onclick = (e) => { e.preventDefault(); openMenuViewer(adminRestObj.name); };
                adminRestMenu.style.display = 'inline-block';
                adminRestMenu.classList.remove('hidden');
            } else {
                adminRestMenu.style.display = 'none';
                adminRestMenu.classList.add('hidden');
            }
        }

        // v240：更新一般使用者側邊欄與手機版的菜單連結
        const userMenuSidebar = document.getElementById('display-rest-menu-sidebar');
        const userMenuMob = document.getElementById('display-rest-menu-mob');
        const userRestName = (restaurantNameInput ? restaurantNameInput.value : '').trim();
        const userRestObj = memoryRestaurants.find(r => r && r.name && r.name.trim() === userRestName);

        const updateMenuBtn = (btn, restObj) => {
            if (btn) {
                if (restObj && restObj.menuUrl) {
                    btn.onclick = () => openMenuViewer(restObj.name);
                    btn.style.display = 'inline-block';
                    btn.classList.remove('hidden');
                } else {
                    btn.style.display = 'none';
                    btn.classList.add('hidden');
                }
            }
        };

        updateMenuBtn(userMenuSidebar, userRestObj);
        updateMenuBtn(userMenuMob, userRestObj);

        if (displayRestPhone) {
            const currentRestName = (restaurantNameInput ? restaurantNameInput.value : '').trim();
            const restObj = memoryRestaurants.find(r => r && r.name && r.name.trim() === currentRestName);
            if (restObj && restObj.phone) {
                displayRestPhone.href = `tel:${restObj.phone}`;
                displayRestPhone.style.display = 'flex';
                displayRestPhone.innerHTML = `📞 ${restObj.phone}`;
            } else {
                displayRestPhone.style.display = 'none';
            }
        }
    }


    function updateQuickOrderLabels() {
        if (!quickOrderLabels) return;
        if (!personNameInput.value) {
            quickOrderLabels.innerHTML = '';
            return;
        }

        const userName = personNameInput.value;
        const userOrders = memoryOrders.filter(o => o.name === userName);

        // 統計該使用者最常點的前三名 (以項目+價格作為唯一鍵)
        const stats = {};
        userOrders.forEach(o => {
            const key = `${o.item}|${o.price}`;
            stats[key] = (stats[key] || 0) + 1;
        });

        const topItems = Object.entries(stats)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3)
            .map(([key]) => {
                const [item, price] = key.split('|');
                return { item, price: parseFloat(price) };
            });

        quickOrderLabels.innerHTML = topItems.map(data =>
            `<span class="quick-label" onclick="fillQuickOrder('${data.item}', ${data.price})">⭐ ${data.item} ($${data.price})</span>`
        ).join('');
    }

    window.fillQuickOrder = function (item, price) {
        itemNameInput.value = item;
        itemPriceInput.value = price;
        showToast(`已自動填入：${item}`, 'info');
    };

    personNameInput.addEventListener('change', updateQuickOrderLabels);

    function getMenuLinkHtml(rName) {
        if (!rName) return '';
        const searchName = String(rName).trim();
        const res = memoryRestaurants.find(r => String(r.name).trim() === searchName);
        if (res && res.menuUrl) {
            return `<a href="${res.menuUrl}" target="_blank" style="text-decoration:none; font-size:1.1rem; margin-left:5px;" title="查看菜單">📄</a>`;
        }
        return '';
    }

    function updateRestaurantMenuDisplay() {
        // v245：點擊同步刷新所有菜單按鈕（管理員 + 一般使用者）
        
        // 1. 管理員面板
        const adminRestMenu = document.getElementById('admin-display-rest-menu');
        const adminRestSelect = document.getElementById('admin-restaurant-name');
        if (adminRestMenu && adminRestSelect) {
            const rName = adminRestSelect.value.trim();
            const rObj = memoryRestaurants.find(r => r.name.trim() === rName);
            if (rObj && rObj.menuUrl) {
                adminRestMenu.onclick = (e) => { e.preventDefault(); openMenuViewer(rObj.name); };
                adminRestMenu.style.display = 'inline-block';
                adminRestMenu.classList.remove('hidden');
            } else {
                adminRestMenu.style.display = 'none';
                adminRestMenu.classList.add('hidden');
            }
        }

        // 2. 一般使用者側邊欄與手機版 (比照管理員邏輯)
        const userMenuSidebar = document.getElementById('display-rest-menu-sidebar');
        const userMenuMob = document.getElementById('display-rest-menu-mob');
        const userRestInput = document.getElementById('restaurant-name');
        const userRestMobInput = document.getElementById('restaurant-name-mob');
        
        const updateUBtn = (btn, input) => {
            if (!btn || !input) return;
            const rName = (input.value || '').trim();
            if (!rName || rName === '待定...') {
                btn.style.display = 'none';
                return;
            }
            const rObj = memoryRestaurants.find(r => r && r.name && r.name.trim() === rName);
            if (rObj && rObj.menuUrl) {
                btn.onclick = (e) => { e.preventDefault(); openMenuViewer(rObj.name); };
                btn.style.display = 'inline-block';
                btn.classList.remove('hidden');
            } else {
                btn.style.display = 'none';
                btn.classList.add('hidden');
            }
        };

        updateUBtn(userMenuSidebar, userRestInput);
        updateUBtn(userMenuMob, userRestMobInput);
    }

    safeListenAll('#restaurant-name, #restaurant-name-mob', 'input', (e) => {
        syncAndRefresh(restaurantInputs, e.target.value, false);
        updateRestaurantMenuDisplay();
    });

    safeListenAll('#order-date, #order-date-mob', 'change', (e) => {
        syncAndRefresh(dateInputs, e.target.value, true);
    });

    safeListenAll('#meal-type, #meal-type-mob', 'change', (e) => {
        syncAndRefresh(mealTypeInputs, e.target.value, true);
    });

    // 鎖單時間確認按鈕
    const handleCutoffConfirm = () => {
        const val = document.getElementById('cutoff-time')?.offsetParent !== null
            ? document.getElementById('cutoff-time').value
            : document.getElementById('cutoff-time-mob').value;

        // ★ 核心修復：必須先將新時間存入 Settings，後續 syncAndRefresh 觸發的 handleFormState 才能讀到正確的值
        const settings = getSettings();
        const m1 = document.getElementById('meal-type');
        const m2 = document.getElementById('meal-type-mob');
        const currentMeal = ((m1 && m1.offsetParent !== null ? m1.value : (m2 ? m2.value : '')) || '午餐').trim();

        settings.mealCutoffs[currentMeal] = val;
        settings.cutoffTime = val;
        saveSettings(settings);

        // 存檔後再同步並刷新畫面
        syncAndRefresh(cutoffInputs, val, true);

        showToast('鎖單時間已更新！');

        if (!excelModal.classList.contains('hidden')) renderOrders();
    };

    safeListenAll('#confirm-cutoff-btn, #confirm-cutoff-mob-btn', 'click', handleCutoffConfirm);

    window.deleteOrder = function (id) {
        if (!confirm('確定要刪除這筆訂單嗎？')) return;
        const orders = getOrders();
        const keepOrders = orders.filter(o => String(o.id) !== String(id));
        // ★ 核心優化：改用 deleteOrder 原子操作
        saveOrders(keepOrders, "deleteOrder", { id: id });
        renderOrders();
        updateGrandTotal();
    };

    window.togglePaid = function (id, isPaid) {
        const orders = getOrders();
        const idx = orders.findIndex(o => String(o.id) === String(id));
        if (idx !== -1) {
            const updatedOrder = { ...orders[idx], paid: isPaid };
            orders[idx] = updatedOrder;
            // 統一使用 updateOrder 動作 (v199)
            saveOrders(orders, "updateOrder", updatedOrder);
            updateGrandTotal();
        }
    };

    function getCommonInputs() {
        return {
            date: document.getElementById('order-date')?.value || document.getElementById('order-date-mob')?.value || getTodayString(),
            meal: document.getElementById('meal-type')?.value || document.getElementById('meal-type-mob')?.value || '午餐',
            rest: document.getElementById('restaurant-name')?.value || document.getElementById('restaurant-name-mob')?.value || '',
            cutoff: document.getElementById('cutoff-time')?.value || document.getElementById('cutoff-time-mob')?.value || '10:30'
        };
    }

    // 新增訂單邏輯
    submitOrderBtn.addEventListener('click', () => {
        const inputs = getCommonInputs();
        const name = personNameInput.value.trim();
        const item = itemNameInput.value.trim();

        // 鎖定檢查已整合至 isSessionLocked
        if (isSessionLocked(inputs.date, inputs.meal)) {
            showToast("此餐期已鎖定，無法新增訂單！", "error");
            return;
        }

        // 點餐者身分：金額強制為 0，且使用登入姓名
        let finalPrice = parseFloat(itemPriceInput.value);
        if (currentUser && currentUser.role === 'user') {
            finalPrice = 0;
        }

        if (!name || !item || !inputs.rest) {
            showToast("請確實填寫姓名、餐點名稱，並確定已選擇餐廳！", "error");
            return;
        }

        if (currentUser && currentUser.role === 'admin' && (isNaN(finalPrice) || finalPrice <= 0)) {
            showToast("開餐者請務必輸入餐點正確金額！", "error");
            return;
        }

        const newOrder = {
            id: Date.now().toString(),
            date: inputs.date,
            mealType: inputs.meal,
            userName: name, // 統一使用 userName
            name: name,     // 保留 name 供前端顯示
            item: item,
            price: finalPrice,
            restaurant: inputs.rest,
            cutoffTime: inputs.cutoff,
            paid: false // 新單預設未付款
        };

        // ★ 視覺反饋：按鈕進入發送狀態
        const originalText = submitOrderBtn.innerHTML;
        submitOrderBtn.disabled = true;
        submitOrderBtn.innerHTML = '🚀 傳送中...';

        const orders = getOrders();
        orders.push(newOrder);
        // ★ 核心優化：改用 addOrder 原子操作
        saveOrders(orders, "addOrder", newOrder);

        // 模擬異步完成後的 UI 恢復 (實際會由 saveCloudData 控制)
        setTimeout(() => {
            if (!submitOrderBtn.disabled) return;
            submitOrderBtn.innerHTML = originalText;
            submitOrderBtn.disabled = false;
        }, 3000);

        // 觸發重新檢查狀態 (會讓餐廳欄位上鎖)
        handleFormState();

        personNameInput.value = '';
        itemNameInput.value = '';
        itemPriceInput.value = '';
        personNameInput.focus();

        currentViewDate = new Date(inputs.date);
        updateGrandTotal();
        showToast(`訂購成功：${item}`, 'success');
    });

    function normalizeDate(val) {
        if (!val) return '';
        // 如果已經是 YYYY-MM-DD 字串，直接回傳
        if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}/.test(val)) return val.substring(0, 10);
        const d = new Date(val);
        if (isNaN(d.getTime())) return String(val).trim();
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
    }

    itemPriceInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') submitOrderBtn.click();
    });



    // Modal 開關
    safeListen(document.getElementById('close-modal-btn'), 'click', () => {
        excelModal.classList.add('hidden');
    });

    // 使用事件委派 (Event Delegation) 處理報表分頁切換
    document.addEventListener('click', (e) => {
        const target = e.target.closest('.tab-btn');
        if (!target || target.closest('.settings-tab-btn')) return; // 排除設定分頁

        const tabName = target.getAttribute('data-tab');
        if (tabName) {
            highlightTab(tabName);
            renderOrders();
        }
    });

    // 額外確保 Modal 背景點擊關閉
    excelModal.addEventListener('click', (e) => {
        if (e.target === excelModal) excelModal.classList.add('hidden');
    });

    // 週導航 (使用安全監聽，防止 ReferenceError)
    safeListen(prevWeekBtn, 'click', () => {
        currentViewDate.setDate(currentViewDate.getDate() - 7);
        renderOrders();
    });
    safeListen(nextWeekBtn, 'click', () => {
        currentViewDate.setDate(currentViewDate.getDate() + 7);
        renderOrders();
    });
    safeListen(currentWeekBtn, 'click', () => {
        currentViewDate = new Date();
        renderOrders();
    });

    // 只更新外層的 Total 與今日統計
    function updateGrandTotal() {
        const wt = getWeekData(currentViewDate);
        const gTotal = wt.weekOrders.reduce((acc, cur) => acc + cur.price, 0);

        const dashGrandTotal = document.getElementById('dash-grand-total');
        if (dashGrandTotal) dashGrandTotal.textContent = `$${gTotal}`;

        const todayStr = getTodayString();
        const allOrders = getOrders();
        const todayOrders = allOrders.filter(o => o.date === todayStr);
        const todayTotal = todayOrders.reduce((acc, cur) => acc + cur.price, 0);

        const dashTodayCount = document.getElementById('dash-today-count');
        const dashTodayTotal = document.getElementById('dash-today-total');
        if (dashTodayCount) dashTodayCount.textContent = todayOrders.length;
        if (dashTodayTotal) dashTodayTotal.textContent = todayTotal;
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
        if (currentWeekLabel) currentWeekLabel.innerText = labelText;

        // ★ 核心優化：記憶目前的捲動位置，避免重新渲染時跳回頂部
        const modalBody = document.querySelector('.modal-body');
        const savedScrollTop = modalBody ? modalBody.scrollTop : 0;
        const savedScrollLeft = modalBody ? modalBody.scrollLeft : 0;

        // 身分過濾：如果角色是 User，則只看得到自己的訂單
        let filteredWeekDates = weekDates;
        let filteredWeekOrders = weekOrders;
        let filteredAllOrders = allOrders;

        if (currentUser && currentUser.role === 'user') {
            filteredWeekOrders = weekOrders.filter(o => o.name === currentUser.name);
            filteredAllOrders = allOrders.filter(o => o.name === currentUser.name);
        }

        const grandTotal = filteredWeekOrders.reduce((sum, o) => sum + o.price, 0);

        // 強制重新取一次容器，確保不會因為 DOM 結構變動而失效
        const container = document.getElementById('dynamic-table-container');
        if (container) {
            container.innerHTML = '';
        } else {
            return; // 若找不到容器則不執行
        }
        if (currentActiveTab === 'tab-details') {
            renderDetailsTable(filteredWeekDates, filteredAllOrders, grandTotal, container);
        } else if (currentActiveTab === 'tab-caller') {
            renderCallerTable(filteredWeekDates, filteredAllOrders, container);
        } else if (currentActiveTab === 'tab-person') {
            renderPersonTable(filteredWeekOrders, grandTotal, container);
        }

        // ★ 核心優化：渲染完成後恢復捲動位置
        if (modalBody) {
            modalBody.scrollTop = savedScrollTop;
            modalBody.scrollLeft = savedScrollLeft;
        }
    }

    // === 表格 1：流水記帳表 (Details) ===
    function renderDetailsTable(weekDates, allOrders, grandTotal, container) {
        const table = document.createElement('table');
        table.className = 'excel-table';
        table.innerHTML = `<thead><tr><th>日期 / 餐廳</th><th>姓名</th><th>餐點</th><th class="amount-col">金額</th><th style="width:50px;">付清</th><th class="action-col">操作</th></tr></thead>`;
        const tbody = document.createElement('tbody');

        weekDates.forEach(({ dateString, dayLabel }) => {
            const dayOrders = allOrders.filter(o => o.date === dateString);

            if (dayOrders.length === 0) {
                const tr = document.createElement('tr');
                if (dayLabel === '(六)' || dayLabel === '(日)') tr.classList.add('weekend-row');
                tr.innerHTML = `<td>${dateString} <span style="font-size:0.8em; color:var(--text-muted);">${dayLabel}</span></td><td colspan="5" style="text-align:center; color:var(--text-muted); background:var(--input-bg);">本週無流水帳明細</td>`;
                tbody.appendChild(tr);
            } else {
                // ★ 核心優化：將餐期按照時間線排序
                const mealOrder = ['早餐', '午餐', '下午茶', '晚餐', '宵夜'];
                const mealTypes = [...new Set(dayOrders.map(o => o.mealType || '午餐'))]
                    .sort((a, b) => mealOrder.indexOf(a) - mealOrder.indexOf(b));

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
                            tdDate.setAttribute('data-label', '日期 / 餐廳');
                            tdDate.rowSpan = sessionOrders.length + 1;
                            const mTypeBadge = `<span style="font-size:0.75rem; background:var(--bg-main); padding:0.1rem 0.3rem; border-radius:0.25rem; font-weight:600; color:var(--text-main); margin-left:0.25rem; border: 1px solid var(--border);">${mType}</span>`;
                            tdDate.innerHTML = `
                                <div style="margin-bottom:0.25rem;">
                                    <b style="color:${dateColor}">${order.date}</b> 
                                    <span style="font-size:0.8em; color:${isWeekend ? 'var(--danger)' : 'var(--text-muted)'}; margin-left: 0.25rem;">${dayLabel}</span>
                                    ${mTypeBadge}
                                </div>
                                <div style="color:var(--primary); font-size:0.95rem; font-weight:600;">
                                    🏠 ${sessionRest}
                                </div>
                            `;
                            tdDate.style.verticalAlign = 'middle';
                            tr.appendChild(tdDate);
                        }

                        const isAdmin = currentUser && currentUser.role === 'admin';
                        const priceDisplay = isAdmin
                            ? `<input type="number" value="${order.price}" class="inline-edit-price" 
                                onchange="window.updateOrderPrice('${order.id}', this.value)" 
                                onkeypress="if(event.key === 'Enter') { window.updateOrderPrice('${order.id}', this.value); this.blur(); }"
                                style="width:60px; padding:2px; border:1px solid var(--border); border-radius:4px; background:var(--bg-main); color:var(--text-main); font-weight:bold; text-align:right;">`
                            : `$${order.price}`;

                        tr.innerHTML += `
                            <td data-label="姓名">${order.name}</td>
                            <td data-label="餐點">${order.item}</td>
                            <td data-label="金額" class="amount-value">${priceDisplay}</td>
                        `;

                        // Paid Checkbox
                        const tdPaid = document.createElement('td');
                        tdPaid.setAttribute('data-label', '付清');
                        tdPaid.style.textAlign = 'center';
                        const chk = document.createElement('input');
                        chk.type = 'checkbox';
                        chk.className = 'paid-checkbox';
                        chk.checked = order.paid;
                        chk.addEventListener('change', (e) => window.togglePaid(order.id, e.target.checked));
                        tdPaid.appendChild(chk);
                        tr.appendChild(tdPaid);

                        // 編輯與刪除按鈕
                        const tdAction = document.createElement('td');
                        tdAction.setAttribute('data-label', '操作');
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
                                // ★ 核心優化：編輯時先刪除舊單（原子操作）
                                saveOrders(newOrders, "deleteOrder", { id: order.id });
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
        container.appendChild(table);
    }

    // === 表格 2：電話叫餐表 (Caller) ===
    function renderCallerTable(weekDates, allOrders, container) {
        const table = document.createElement('table');
        table.className = 'excel-table';
        table.innerHTML = `<thead><tr><th>日期 / 餐期 / 餐廳</th><th>餐點明細匯總 (唸給老闆聽)</th><th class="amount-col">金額小計</th></tr></thead>`;
        const tbody = document.createElement('tbody');

        weekDates.forEach(({ dateString, dayLabel }) => {
            const dayOrders = allOrders.filter(o => o.date === dateString);
            if (dayOrders.length === 0) return;

            const mealOrder = ['早餐', '午餐', '下午茶', '晚餐', '宵夜'];
            const mealTypes = [...new Set(dayOrders.map(o => o.mealType || '午餐'))]
                .sort((a, b) => mealOrder.indexOf(a) - mealOrder.indexOf(b));

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
                    <td data-label="日期 / 餐廳" style="vertical-align:top;">
                        <b style="color:${dateColor}">${dateString}</b> <span style="font-size:0.8em; color:${isWeekend ? 'var(--danger)' : 'var(--text-muted)'}; margin-left:0.25rem;">${dayLabel}</span> ${mTypeBadge}
                        <span style="color:var(--primary); font-weight:600; font-size:1.1rem; margin-left:0.5rem;">${sessionRest}</span>
                    </td>
                    <td data-label="餐點彙總" style="vertical-align:top;">${itemsArr.join('')}</td>
                    <td data-label="金額小計" class="amount-value" style="vertical-align:top; font-weight:bold; font-size:1.1rem; color:var(--text-main);">$${sessionTotal}</td>
                `;
                tbody.appendChild(tr);
            });
        });

        if (tbody.children.length === 0) {
            tbody.innerHTML = `<tr><td colspan="3" style="text-align:center; color:var(--text-muted); padding: 2rem;">本週無電話叫餐彙總紀錄</td></tr>`;
        }

        table.appendChild(tbody);
        container.appendChild(table);
    }

    // === 表格 3：收錢總帳表 (Person) ===
    function renderPersonTable(weekOrders, grandTotal, container) {
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
                statusHtml = `<div style="color:var(--success); white-space:nowrap;">✅ 已結清</div>`;
            } else {
                statusHtml = `<div style="color:var(--danger); margin-bottom:0.25rem; white-space:nowrap;">❌ 未結清</div>`;
            }

            tr.innerHTML = `
                <td data-label="姓名" style="font-weight:600; font-size:1.1rem;">${name}</td>
                <td data-label="點餐次數" style="text-align:center;">${data.count} 筆</td>
                <td data-label="總花費" class="amount-value" style="color:var(--text-muted);">$${data.total}</td>
                <td data-label="已繳交" class="amount-value" style="color:var(--success);">$${data.paidTotal}</td>
                <td data-label="尚欠款" class="amount-value" style="color:var(--danger); font-weight:700;">$${remains}</td>
                <td data-label="目前狀態" class="status-cell" style="text-align:center; font-weight:600; vertical-align:middle;">
                    ${statusHtml}
                </td>
            `;

            // 動態塞入「一鍵結清」按鈕
            if (!isAllPaid) {
                const tdStatus = tr.querySelector('.status-cell');
                const settleBtn = document.createElement('button');
                settleBtn.className = 'settle-all-btn';
                settleBtn.innerText = '💸 一鍵結清';
                settleBtn.style.whiteSpace = 'nowrap';
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
        container.appendChild(table);
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
                // 增加備份方案，防止 undefined
                const displayName = u.name || u.userName || '未知';
                html += `<tr><td data-label="人員名稱">${displayName}</td><td data-label="操作" style="text-align:center;"><button class="secondary-btn" style="color:var(--danger);" onclick="deleteUser('${u.id}')">刪除</button></td></tr>`;
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
                        `<label class="day-toggle-item">
                            <input type="checkbox" name="edit-open-day" value="${i}" ${openDaysArr.includes(String(i)) ? 'checked' : ''}>
                            <span class="day-toggle-btn">週${day}</span>
                        </label>`).join('');
                    html += `<div style="background:var(--input-bg);border:1px solid var(--primary);border-radius:0.5rem;padding:1rem;margin-bottom:1rem;">`;
                    html += `<h4 style="margin-top:0;color:var(--primary);">✏️ 編輯：${r.name}</h4>`;
                    html += `<div class="form-group"><label>店名 *</label><input type="text" id="edit-rest-name" class="restaurant-input" value="${r.name || ''}"></div>`;
                    html += `<div class="form-group"><label>電話</label><input type="text" id="edit-rest-phone" class="restaurant-input" placeholder="02-1234-5678" value="${r.phone || ''}"></div>`;
                    html += `<div class="form-group"><label>地址</label><input type="text" id="edit-rest-address" class="restaurant-input" placeholder="台北市..." value="${r.address || ''}"></div>`;
                    html += `<div class="form-group"><label>菜單網址 (選填)</label><input type="text" id="edit-rest-menu" class="restaurant-input" placeholder="https://..." value="${r.menuUrl || ''}"></div>`;

                    // 照片上傳區 (v176)
                    html += `<div class="form-group"><label>📸 菜單照片 (取代網址)</label>
                        <div style="display:flex; gap:0.5rem; align-items:center;">
                            <input type="file" id="edit-rest-file" accept="image/*" style="display:none;">
                            <button type="button" onclick="document.getElementById('edit-rest-file').click()" class="nav-btn" style="flex:1; justify-content:center; background:var(--bg-main);">📸 選擇照片</button>
                            ${r.menuImage ? `<button id="del-edit-rest-img" class="secondary-btn" style="color:var(--danger);">🗑️ 移除</button>` : ''}
                        </div>
                        <div id="edit-rest-img-preview" style="margin-top:0.5rem; ${r.menuImage ? '' : 'display:none;'} border-radius:0.5rem; overflow:hidden; border:1px solid var(--border);">
                            <img src="${r.menuImage || ''}" style="width:100%; display:block;">
                        </div>
                    </div>`;

                    html += `<div class="form-group"><label>營業日</label><div class="day-toggle-group">${dayChecks}</div></div>`;
                    html += `<div style="display:flex;gap:0.5rem;margin-top:1rem;"><button id="save-edit-rest-btn" class="primary-btn" style="flex:1;">💾 儲存變更</button><button id="cancel-edit-rest-btn" class="secondary-btn">取消</button></div>`;
                    html += `</div>`;
                }
            } else {
                // ─── 新增表單 ─────────────────────────────────
                const newDayChecks = dayNames.map((day, i) =>
                    `<label class="day-toggle-item">
                        <input type="checkbox" name="new-open-day" value="${i}" ${i >= 1 && i <= 5 ? 'checked' : ''}>
                        <span class="day-toggle-btn">週${day}</span>
                    </label>`).join('');
                html += `<div style="background:var(--input-bg);border:1px solid var(--border);border-radius:0.5rem;padding:1rem;margin-bottom:1rem;">`;
                html += `<div style="display:flex;gap:0.5rem;margin-bottom:0.5rem;"><input type="text" id="new-rest-name" class="restaurant-input" placeholder="店名 *" style="flex:2;"><input type="text" id="new-rest-phone" class="restaurant-input" placeholder="電話 (選填)" style="flex:1;"></div>`;
                html += `<input type="text" id="new-rest-address" class="restaurant-input" placeholder="地址 (選填)" style="width:100%;margin-bottom:0.5rem;">`;
                html += `<input type="text" id="new-rest-menu" class="restaurant-input" placeholder="菜單網址 (選填)" style="width:100%;margin-bottom:0.5rem;">`;

                // 新增模式的照片上傳 (v176)
                html += `<div class="form-group" style="margin-bottom:0.5rem;"><label style="font-size:0.85rem; color:var(--text-muted);">📸 菜單照片 (選填)</label>
                    <input type="file" id="new-rest-file" accept="image/*" style="display:none;">
                    <div style="display:flex; gap:0.5rem;">
                        <button type="button" onclick="document.getElementById('new-rest-file').click()" class="nav-btn" style="flex:1; font-size:0.85rem; justify-content:center;">📸 選擇照片</button>
                    </div>
                    <div id="new-rest-img-preview" style="margin-top:0.5rem; display:none; border-radius:0.5rem; overflow:hidden; border:1px solid var(--border);">
                        <img src="" style="width:100%; display:block;">
                    </div>
                </div>`;

                html += `<div class="day-toggle-group">${newDayChecks}</div>`;
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
                    html += `<td data-label="店名">${menuBtn}<strong>${r.name}</strong>${r.address ? `<br><small style="color:var(--text-muted);">${r.address}</small>` : ''}</td>`;
                    html += `<td data-label="電話">${r.phone || '-'}</td>`;
                    html += `<td data-label="營業日" style="font-size:0.8rem;">${openDaysStr}</td>`;
                    html += `<td data-label="操作" style="text-align:center;white-space:nowrap;"><button class="secondary-btn" onclick="editRestaurant('${r.id}')" style="margin-right:4px;">編輯</button><button class="secondary-btn" style="color:var(--danger);" onclick="deleteRestaurant('${r.id}')">刪除</button></td>`;
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


            // (每週預定排餐表已移至首頁，此處不再渲染)

            html += `<div class="form-group" style="margin-bottom:1rem; padding-bottom:1rem; border-bottom:1px solid var(--border);"><label>預設每天投票截止時間</label>`;
            html += `<input type="time" id="config-vote-time" class="restaurant-input time-input" value="${currentCutoff}"></div>`;

            html += `<div class="form-group" style="margin-bottom:1rem; padding-bottom:1rem; border-bottom:1px solid var(--border);"><label>指定特定日期的投票截止時間 (優先於預設)</label>`;
            html += `<div style="display:flex; flex-wrap:wrap; gap:0.5rem; margin-bottom:0.5rem;">
                <input type="date" id="new-cutoff-date" class="restaurant-input time-input" style="flex:1; min-width:120px;" value="${todayStr}">
                <select id="new-cutoff-meal" class="restaurant-input" style="flex:1; min-width:100px;">
                    <option value="全天">全天 (通用)</option>
                    <option value="早餐">早餐</option>
                    <option value="午餐" selected>午餐</option>
                    <option value="下午茶">下午茶</option>
                    <option value="晚餐">晚餐</option>
                    <option value="宵夜">宵夜</option>
                </select>
                <input type="time" id="new-cutoff-time" class="restaurant-input time-input" style="flex:1; min-width:100px;" value="${currentCutoff}">
                <button id="add-cutoff-btn" class="primary-btn" style="flex:none;">新增設定</button>
            </div>`;
            html += `<table class="excel-table"><thead><tr><th>指定日期</th><th>餐期</th><th>截止時間</th><th>操作</th></tr></thead><tbody>`;

            let needSilentCleanup = false;
            let hasOverrides = false;

            Object.keys(memoryConfig).forEach(k => {
                if (k.startsWith('cutoff_')) {
                    const parts = k.replace('cutoff_', '').split('_');
                    const dateStr = parts[0];

                    // ★ 核心優化：如果日期已過，自動從列表排除並標記需要清理
                    if (dateStr < todayStr) {
                        delete memoryConfig[k];
                        needSilentCleanup = true;
                        return;
                    }

                    hasOverrides = true;
                    const mealStr = parts[1] || '全天';
                    const timeStr = normalizeTime(memoryConfig[k]);
                    html += `<tr><td data-label="指定日期">${dateStr}</td><td data-label="餐期">${mealStr}</td><td data-label="截止時間">${timeStr}</td><td data-label="操作" style="text-align:center;"><button class="secondary-btn" style="color:var(--danger);" onclick="deleteCutoffOverride('${k}')">刪除</button></td></tr>`;
                }
            });

            // ★ 如果有過期設定，自動同步回雲端以保持資料庫整潔
            if (needSilentCleanup) {
                const newConfig = [];
                Object.keys(memoryConfig).forEach(k => {
                    let val = memoryConfig[k];
                    if (k === 'voteCutoffTime' || k.startsWith('cutoff_')) val = "'" + normalizeTime(val);
                    newConfig.push({ key: k, value: val });
                });
                saveCloudData("saveConfig", newConfig);
                console.log("已自動清理過期的日期設定");
            }

            if (!hasOverrides) html += `<tr><td colspan="4" style="text-align:center; color:var(--text-muted);">無特定日期設定 (皆使用上方預設時間)</td></tr>`;
            html += `</tbody></table></div>`;

            // (系統設定密碼已刪除)
            html += `<button id="save-config-btn" class="primary-btn" style="width:100%;">儲存設定</button>`;

        }

        container.innerHTML = html;

        // Bind events
        if (activeSettingsTab === 'tab-users') {
            const addUserBtn = document.getElementById('add-user-btn');
            const newUserNameInput = document.getElementById('new-user-name');
            if (addUserBtn) {
                addUserBtn.onclick = () => {
                    const n = newUserNameInput.value.trim();
                    if (n) {
                        const newUsers = [...memoryUsers, { id: 'U' + Date.now(), name: n }];
                        saveUsers(newUsers);
                        showToast(`已新增人員：${n}`);
                        newUserNameInput.value = '';
                        renderSettingsTab();
                    } else {
                        showToast('請輸入人員姓名', 'error');
                    }
                };
            }
        } else if (activeSettingsTab === 'tab-restaurants') {
            if (window._editingRestaurantId) {
                const saveBtn = document.getElementById('save-edit-rest-btn');
                if (saveBtn) {
                    saveBtn.onclick = () => {
                        const r = memoryRestaurants.find(r => r.id === window._editingRestaurantId);
                        if (!r) return;
                        const newName = document.getElementById('edit-rest-name').value.trim();
                        if (!newName) { showToast('店名不能為空', 'error'); return; }
                        r.name = newName;
                        r.phone = document.getElementById('edit-rest-phone').value.trim();
                        r.address = document.getElementById('edit-rest-address').value.trim();
                        r.menuUrl = document.getElementById('edit-rest-menu').value.trim();

                        // 處理照片 (v176)
                        const previewImg = document.querySelector('#edit-rest-img-preview img');
                        if (previewImg && previewImg.src.startsWith('data:image')) {
                            r.menuImage = previewImg.src;
                        } else if (!previewImg || previewImg.src === '') {
                            r.menuImage = '';
                        }

                        const checked = [...document.querySelectorAll('input[name="edit-open-day"]:checked')].map(cb => cb.value);
                        r.openDays = checked.join(',');
                        window._editingRestaurantId = null;
                        saveRestaurants([...memoryRestaurants]);
                        showToast(`已更新餐廳：${newName}`);
                        renderSettingsTab();
                        renderVotingSection();
                    };
                }

                // 綁定檔案選取監聽器 (v176)
                const editFile = document.getElementById('edit-rest-file');
                if (editFile) {
                    editFile.onchange = (e) => {
                        const file = e.target.files[0];
                        if (file) handleImageFile(file, '#edit-rest-img-preview');
                    };
                }
                const delEditImg = document.getElementById('del-edit-rest-img');
                if (delEditImg) {
                    delEditImg.onclick = () => {
                        const container = document.getElementById('edit-rest-img-preview');
                        container.style.display = 'none';
                        container.querySelector('img').src = '';
                    };
                }
                const cancelBtn = document.getElementById('cancel-edit-rest-btn');
                if (cancelBtn) {
                    cancelBtn.onclick = () => {
                        window._editingRestaurantId = null;
                        renderSettingsTab();
                    };
                }
            } else {
                const addBtn = document.getElementById('add-rest-btn');
                if (addBtn) {
                    addBtn.onclick = () => {
                        const n = document.getElementById('new-rest-name').value.trim();
                        if (!n) { showToast('請輸入店名', 'error'); return; }
                        const phone = document.getElementById('new-rest-phone').value.trim();
                        const address = document.getElementById('new-rest-address').value.trim();
                        const menuUrl = document.getElementById('new-rest-menu').value.trim();

                        // 處理照片 (v176)
                        const previewImg = document.querySelector('#new-rest-img-preview img');
                        const menuImage = (previewImg && previewImg.src.startsWith('data:image')) ? previewImg.src : '';

                        const checked = [...document.querySelectorAll('input[name="new-open-day"]:checked')].map(cb => cb.value);
                        const newRest = {
                            id: 'R' + Date.now(),
                            name: n,
                            phone,
                            address,
                            openDays: checked.join(','),
                            menuUrl,
                            menuImage // v176
                        };
                        saveRestaurants([...memoryRestaurants, newRest]);
                        showToast(`已新增餐廳：${n}`);
                        renderSettingsTab();
                        renderVotingSection();
                    };
                }

                // 綁定檔案選取監聽器 (v176)
                const newFile = document.getElementById('new-rest-file');
                if (newFile) {
                    newFile.onchange = (e) => {
                        const file = e.target.files[0];
                        if (file) handleImageFile(file, '#new-rest-img-preview');
                    };
                }
            }
        } else if (activeSettingsTab === 'tab-config') {
            document.getElementById('save-config-btn').onclick = () => {
                const t = document.getElementById('config-vote-time').value;

                memoryConfig.voteCutoffTime = t;
                const newConfig = [];
                Object.keys(memoryConfig).forEach(k => {
                    let val = memoryConfig[k];
                    if (k === 'voteCutoffTime' || k.startsWith('cutoff_')) val = "'" + normalizeTime(val);
                    newConfig.push({ key: k, value: val });
                });
                saveCloudData("saveConfig", newConfig);
                showToast('系統設定儲存成功');
                renderSettingsTab();
                renderVotingSection();
            };

            document.getElementById('add-cutoff-btn').onclick = () => {
                const dateVal = document.getElementById('new-cutoff-date').value;
                const mealVal = document.getElementById('new-cutoff-meal').value;
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

                // 修改 key 的組成，加入餐期區分
                const key = 'cutoff_' + dateVal + (mealVal === '全天' ? '' : '_' + mealVal);
                memoryConfig[key] = timeVal;

                const newConfig = [];
                Object.keys(memoryConfig).forEach(k => {
                    let val = memoryConfig[k];
                    if (k === 'voteCutoffTime' || k.startsWith('cutoff_')) val = "'" + normalizeTime(val);
                    newConfig.push({ key: k, value: val });
                });
                saveCloudData("saveConfig", newConfig);
                showToast(`已新增 ${dateVal} ${mealVal} 的時間設定`);
                renderSettingsTab();
                renderVotingSection();
            };


        }
    }

    window.deleteUser = function (id) {
        if (confirm('確定刪除此人員？')) {
            const user = memoryUsers.find(u => u.id === id);
            saveUsers(memoryUsers.filter(u => u.id !== id));
            showToast(`已刪除人員：${user ? user.name : ''}`);
            renderSettingsTab();
        }
    };

    window.editRestaurant = function (id) {
        window._editingRestaurantId = id;
        renderSettingsTab();
    };

    window.deleteRestaurant = function (id) {
        if (confirm('確定刪除此餐廳？')) {
            const rest = memoryRestaurants.find(r => r.id === id);
            saveRestaurants(memoryRestaurants.filter(r => r.id !== id));
            showToast(`已刪除餐廳：${rest ? rest.name : ''}`);
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
            showToast('日期設定已刪除');
            renderSettingsTab();
            renderVotingSection();
        }
    }

    // === 投票系統 UI ===
    function renderVotingSection() {
        const vSec = document.getElementById('voting-section');
        if (!vSec) return;

        // v234：如果目前是管理員模式，強制隱藏投票區且不再往下執行渲染
        const isAdmin = currentUser && currentUser.role === 'admin';
        if (isAdmin) {
            vSec.classList.add('hidden');
            return;
        }

        // 讀取日期與餐期
        const d1 = document.getElementById('order-date');
        const d2 = document.getElementById('order-date-mob');
        const selectedDateStr = (d1 && d1.value ? d1.value : (d2 ? d2.value : '')) || getTodayString();

        const m1 = document.getElementById('meal-type');
        const m2 = document.getElementById('meal-type-mob');
        const mType = ((m1 && m1.value ? m1.value : (m2 ? m2.value : '')) || '午餐').trim();

        const now = new Date();
        const curHH = String(now.getHours()).padStart(2, '0');
        const curMM = String(now.getMinutes()).padStart(2, '0');
        const curTimeStr = `${curHH}:${curMM}`;

        const todayStr = getTodayString();

        // ★ 核心修復：優先尋找該餐期的專屬日期設定
        let storedTime = memoryConfig['cutoff_' + selectedDateStr + '_' + mType] || memoryConfig['cutoff_' + selectedDateStr];

        // 讀取主畫面的「鎖單時間」 (使用強化的偵測邏輯)
        const currentOrderCutoff = getActiveCutoffTime();

        if (storedTime !== undefined && storedTime !== '') {
            storedTime = normalizeTime(storedTime);
        }

        // 統一規則：直接以畫面上看到的鎖單時間為基準，減去 15 分鐘作為投票截止
        const [h, m] = currentOrderCutoff.split(':').map(Number);
        let totalMins = h * 60 + m - 15;
        if (totalMins < 0) totalMins = 0;
        const vH = String(Math.floor(totalMins / 60)).padStart(2, '0');
        const vM = String(totalMins % 60).padStart(2, '0');
        const voteCutoff = `${vH}:${vM}`;

        // 此餐期的現有訂單——改用 getOrders() 確保拿到最新本地訂單，遠首著隱藏投票區
        const sessionOrders = getOrders().filter(o => o.date === selectedDateStr && (o.mealType || '午餐') === mType);

        // ★ 核心優化：投票區的隱藏只看「時間是否已過」或「是否已開單」
        // 不再受 isLocked (餐期順序) 的限制，避免早餐時段看不見午餐投票的問題
        const isTimePast = (selectedDateStr < todayStr) || (selectedDateStr === todayStr && curTimeStr >= voteCutoff);

        if (sessionOrders.length > 0 || isTimePast) {
            vSec.classList.add('hidden');

            // ★ 投票截止或已有訂單時，才將建議餐廳帶入（且僅在欄位為空時）
            // 如果有訂單 → 用訂單的餐廳；如果投票截止 → 用管理員預設（adminOnly）
            let winnerName = '';
            if (sessionOrders.length > 0) {
                const recommendation = getRecommendedRestaurant(selectedDateStr, mType);
                winnerName = recommendation.name;
            } else if (isTimePast) {
                // 只取管理員預設，不採用投票結果（因為投票已截止但無人投票）
                const adminRec = getRecommendedRestaurant(selectedDateStr, mType, true);
                winnerName = adminRec.name;
            }

            if (winnerName) {
                const ri1 = document.getElementById('restaurant-name');
                const ri2 = document.getElementById('restaurant-name-mob');
                if (ri1 && !ri1.value) ri1.value = winnerName;
                if (ri2 && !ri2.value) ri2.value = winnerName;
                if (typeof updateRestaurantMenuDisplay === 'function') {
                    updateRestaurantMenuDisplay();
                }
            }
            return;
        }

        // 投票仍進行中：確保餐廳欄位清空，不預先鎖定
        const ri1c = document.getElementById('restaurant-name');
        const ri2c = document.getElementById('restaurant-name-mob');
        if (ri1c && !ri1c.disabled) ri1c.value = '';
        if (ri2c && !ri2c.disabled) ri2c.value = '';

        // 可以顯示投票區
        vSec.classList.remove('hidden');
        const countdownEl = document.getElementById('voting-countdown');
        if (countdownEl) {
            countdownEl.innerHTML = `<div>目前鎖單時間：<b>${currentOrderCutoff}</b></div><div style="color:var(--primary);">投票截止時間：<b>${voteCutoff}</b> (鎖單前 15 分)</div>`;
        }

        const container = document.getElementById('voting-options');
        if (!container) return;
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
            const menuLink = r.menuUrl ? `<button class="action-btn-mini" onclick="openMenuViewer('${r.name}')" style="border:none; font-size:0.75rem; padding:0.2rem 0.5rem; background:var(--primary); color:white; border-radius:0.5rem; border:1px solid var(--primary); display:inline-block; margin-left:0.5rem; cursor:pointer;">📄 菜單</button>` : '';
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

        const selectedDateStr = (document.getElementById('order-date')?.value || document.getElementById('order-date-mob')?.value) || getTodayString();
        const mType = ((document.getElementById('meal-type')?.value || document.getElementById('meal-type-mob')?.value) || '午餐').trim();

        // 找尋是否有投過了
        let updatedVotes = memoryVotes.filter(v => !(v.date === selectedDateStr && v.mealType === mType && v.userName === person));

        const isModifying = updatedVotes.length < memoryVotes.length;
        const newVote = { date: selectedDateStr, mealType: mType, userName: person, restaurantName: restRadio.value };

        updatedVotes.push(newVote);

        if (isModifying) {
            showToast('正在修改投票...', 'info');
        } else {
            showToast('正在送出投票...', 'info');
        }

        saveVotes(updatedVotes, newVote).then(success => {
            if (success) {
                if (isModifying) {
                    showToast('已修改您的投票！', 'success');
                } else {
                    showToast('✅ 投票成功！', 'success');
                }
                renderVotingSection();
            } else {
                alert('⚠️ 投票失敗！\n這可能是因為網路連線不穩或後端暫時無回應。\n請檢查網路並重新嘗試。');
            }
        });
    });

    // 監聽重新選餐期以重繪投票 (已在上方 syncAndRefresh 處理，故此處移除冗餘或增加安全檢查)
    // 監聽重新選餐期以重繪投票
    const mt1 = document.getElementById('meal-type');
    const mt2 = document.getElementById('meal-type-mob');
    const syncMeal = (e) => {
        if (mt1) mt1.value = e.target.value;
        if (mt2) mt2.value = e.target.value;
        renderVotingSection();
        handleFormState();
    };
    if (mt1) mt1.addEventListener('change', syncMeal);
    if (mt2) mt2.addEventListener('change', syncMeal);

    // 同步日期
    const dt1 = document.getElementById('order-date');
    const dt2 = document.getElementById('order-date-mob');
    const syncDate = (e) => {
        if (dt1) dt1.value = e.target.value;
        if (dt2) dt2.value = e.target.value;
        renderOrders();
        renderVotingSection();
        handleFormState();
    };
    if (dt1) dt1.addEventListener('change', syncDate);
    if (dt2) dt2.addEventListener('change', syncDate);

    // 事件綁定 (使用 safeListen)
    safeListen(document.getElementById('close-modal-btn'), 'click', () => {
        const modal = document.getElementById('excel-modal');
        if (modal) modal.classList.add('hidden');
    });

    // --- 帳號制驗證系統 (v173) ---
    function checkAuth() {
        const storedUser = localStorage.getItem('lunch_user');
        if (storedUser) {
            currentUser = JSON.parse(storedUser);
            loginOverlay.style.display = 'none';
            toggleRoleUI();
        } else {
            loginOverlay.style.display = 'flex';
        }
    }

    function toggleAuthMode() {
        authMode = (authMode === 'login') ? 'register' : 'login';
        loginTitle.innerText = (authMode === 'login') ? '登入系統' : '註冊新帳號';
        loginSubtitle.innerText = (authMode === 'login') ? '請輸入您的姓名與密碼' : '請設定您的帳號姓名與密碼';
        authSubmitBtn.innerText = (authMode === 'login') ? '立即登入' : '完成註冊並登入';
        document.getElementById('auth-switch-link').innerText = (authMode === 'login') ? '點我註冊' : '已有帳號？點我登入';
        document.getElementById('auth-switch-note').firstChild.textContent = (authMode === 'login') ? '還沒有帳號嗎？ ' : '';
        registerNote.style.display = (authMode === 'login') ? 'none' : 'block';
    }

    function handleAuthSubmit() {
        const name = authNameInput.value.trim();
        const pass = authPassInput.value.trim();

        if (!name || !pass) {
            showToast("請完整輸入姓名與密碼", "error");
            return;
        }

        if (authMode === 'login') {
            // 登入邏輯
            // 1. 檢查預設 Admin
            if (name === 'admin' && pass === '1234') {
                loginSuccess(name, 'admin');
                return;
            }

            // 2. 檢查資料庫使用者 (強制轉字串比對，防止數字密碼失效)
            const user = memoryUsers.find(u => String(u.name) === String(name));
            if (user && String(user.password) === String(pass)) {
                loginSuccess(name, user.role || 'user');
            } else {
                showToast("姓名或密碼錯誤", "error");
            }
        } else {
            // 註冊邏輯
            const exists = memoryUsers.some(u => u.name === name);
            if (exists || name === 'admin') {
                showToast("此姓名已被使用", "error");
                return;
            }

            const newUser = {
                id: 'U' + Date.now(),
                name: name,
                password: pass,
                role: 'user'
            };

            // 立即設定當前使用者狀態，防止被同步覆蓋
            currentUser = { name: name, role: 'user', password: pass };
            memoryUsers.push(newUser);
            saveUsers(memoryUsers);
            loginSuccess(name, 'user', pass);
        }
    }

    function loginSuccess(name, role, password = '') {
        // 如果有傳入密碼或是從資料庫找到密碼，就存入 currentUser
        const finalPassword = password || memoryUsers.find(u => u.name === name)?.password || '';
        currentUser = { name: name, role: role, password: finalPassword };
        localStorage.setItem('lunch_user', JSON.stringify(currentUser));
        loginOverlay.style.display = 'none';
        showToast(`歡迎回來，${name}！`, "success");
        toggleRoleUI();
    }

    function toggleRoleUI() {
        if (!currentUser) return;
        const isAdmin = currentUser.role === 'admin';

        // 觸發 2-column admin 版面佈局
        document.body.classList.toggle('admin-mode', isAdmin);

        // 切換 Admin 專屬元素 (sidebar 的鎖單時間等)
        document.querySelectorAll('.admin-only').forEach(el => {
            el.style.display = isAdmin ? '' : 'none';
        });

        // 管理員：顯示控制面板，隱藏點餐表單和投票區、隱藏左下角設定
        // 一般使用者：隱藏管理員面板，顯示點餐表單
        const adminDash = document.getElementById('admin-dashboard');
        const orderForm = document.getElementById('order-form-container');
        const votingSec = document.getElementById('voting-section');
        const sidebarSettings = document.getElementById('sidebar-settings-group');

        if (isAdmin) {
            if (adminDash) adminDash.style.display = '';
            if (orderForm) orderForm.style.display = 'none';
            // 管理員不需要看到投票區
            if (votingSec) votingSec.classList.add('hidden');
            // 隱藏左下角的原設定區塊
            if (sidebarSettings) sidebarSettings.style.display = 'none';
            
            // 渲染管理員面板的每週排餐表
            renderAdminWeeklySchedule();
            // 同步管理員面板的控制欄位與側邊欄值
            syncAdminDashboard();

            // 手機版特有調整：隱藏冗餘的使用者設定列 (v231)
            const mobSettingsRow = document.querySelector('.mobile-settings-row');
            if (mobSettingsRow) mobSettingsRow.style.display = 'none';

            // 更新導航標籤 (個人 -> 總帳)
            const personBtnSpan = document.querySelector('.nav-person-btn span');
            if (personBtnSpan) personBtnSpan.textContent = '總帳';
        } else {
            // 一般使用者模式
            if (adminDash) adminDash.style.display = 'none';
            if (orderForm) orderForm.style.display = '';
            if (sidebarSettings) sidebarSettings.style.display = '';

            const mobSettingsRow = document.querySelector('.mobile-settings-row');
            if (mobSettingsRow) mobSettingsRow.style.display = '';

            const personBtnSpan = document.querySelector('.nav-person-btn span');
            if (personBtnSpan) personBtnSpan.textContent = '個人';
            // 一般使用者：帶入姓名並鎖定
            if (personNameInput) {
                personNameInput.value = currentUser.name;
                personNameInput.disabled = true;
            }
            const votePersonSel = document.getElementById('vote-person');
            if (votePersonSel) {
                if (![...votePersonSel.options].some(o => o.value === currentUser.name)) {
                    const opt = document.createElement('option');
                    opt.value = currentUser.name;
                    opt.textContent = currentUser.name;
                    votePersonSel.appendChild(opt);
                }
                votePersonSel.value = currentUser.name;
                votePersonSel.disabled = true;
            }
        }

        renderOrders(); // 刷新表格 (角色過濾)
    }

    // 同步管理員面板的控制值與主要側邊欄
    function syncAdminDashboard() {
        const adminDate = document.getElementById('admin-order-date');
        const adminMeal = document.getElementById('admin-meal-type');
        const adminRest = document.getElementById('admin-restaurant-name');
        const adminCutoff = document.getElementById('admin-cutoff-time');

        const sideDate = document.getElementById('order-date');
        const sideMeal = document.getElementById('meal-type');
        const sideRest = document.getElementById('restaurant-name');
        const sideCutoff = document.getElementById('cutoff-time');

        if (adminDate && sideDate) adminDate.value = sideDate.value;
        if (adminMeal && sideMeal) adminMeal.value = sideMeal.value;
        if (adminCutoff && sideCutoff) adminCutoff.value = sideCutoff.value;

        // 填充管理員的餐廳下拉選單
        if (adminRest) {
            const oldVal = adminRest.value || (sideRest ? sideRest.value : '');
            adminRest.innerHTML = '<option value="">請選擇餐廳...</option>';
            
            // 取得選定日期對應的星期 (0-6，0為週日)
            const dStr = (adminDate && adminDate.value) ? adminDate.value : getTodayString();
            const dateObj = new Date(dStr + 'T12:00:00');
            const dayOfWeek = dateObj.getDay(); 
            
            // 過濾今天有營業的餐廳
            const openRestaurants = memoryRestaurants.filter(r => {
                if (!r.openDays) return true; // 若未設定視為皆有營業
                const days = r.openDays.split(',').map(d => parseInt(d.trim()));
                return days.includes(dayOfWeek);
            });

            openRestaurants.forEach(r => {
                const opt = document.createElement('option');
                opt.value = r.name;
                opt.textContent = r.name;
                adminRest.appendChild(opt);
            });
            adminRest.value = oldVal;
        }

        // v241：同步後立即刷新菜單按鈕狀態
        updateRestaurantMenuDisplay();
    }

    // 渲染管理員面板的每週排餐表
    function renderAdminWeeklySchedule() {
        const container = document.getElementById('admin-weekly-schedule');
        if (!container) return;
        
        // v228：支援按餐期設定每週排餐
        if (!window._currentWeeklyMealType) window._currentWeeklyMealType = '午餐';
        const mealType = window._currentWeeklyMealType;

        const meals = ['早餐', '午餐', '下午茶', '晚餐', '宵夜'];
        let mealOptions = meals.map(m => `<option value="${m}" ${m === mealType ? 'selected' : ''}>${m}</option>`).join('');

        let html = `<div style="display:flex; align-items:center; gap:0.75rem; margin-bottom:1rem;">
            <span style="font-weight:bold; color:var(--primary);">🗓️ 設定餐期預排：</span>
            <select id="admin-weekly-meal-selector" class="restaurant-input" style="width:auto; min-width:120px; border:2px solid var(--primary);">
                ${mealOptions}
            </select>
        </div>`;

        html += `<table class="excel-table" style="font-size:0.9rem; min-width:100%;"><thead><tr>
            <th>星期一</th><th>星期二</th><th>星期三</th><th>星期四</th><th>星期五</th><th>星期六</th><th>星期日</th>
        </tr></thead><tbody><tr>`;
        
        for (let i = 1; i <= 7; i++) {
            const key = `weekly_${mealType}_${i}`;
            const oldKey = `weekly_${i}`;
            // 優先抓取餐期專用 key，若無且為午餐則抓取舊版 key
            const val = memoryConfig[key] || (mealType === '午餐' ? memoryConfig[oldKey] : '') || '';
            const dayIdx = (i === 7) ? 0 : i; 
            
            const openInDay = memoryRestaurants.filter(r => {
                if (!r.openDays) return true;
                const days = r.openDays.split(',').map(d => parseInt(d.trim()));
                return days.includes(dayIdx);
            });

            html += `<td><select class="admin-weekly-select" data-day="${i}" style="width:100%; padding:4px; border-radius:4px; border:1px solid var(--border); background:var(--bg-main); color:var(--text-main);">
                <option value="">(無)</option>
                ${openInDay.map(r => `<option value="${r.name}" ${val === r.name ? 'selected' : ''}>${r.name}</option>`).join('')}
            </select></td>`;
        }
        html += `</tr></tbody></table>`;
        container.innerHTML = html;

        // 綁定切換事件
        const selector = document.getElementById('admin-weekly-meal-selector');
        if (selector) {
            selector.onchange = (e) => {
                window._currentWeeklyMealType = e.target.value;
                renderAdminWeeklySchedule();
            };
        }
    }

    window.updateOrderPrice = function (id, newPrice) {
        const price = parseFloat(newPrice) || 0;
        const orders = getOrders();
        const idx = orders.findIndex(o => String(o.id) === String(id));
        if (idx !== -1) {
            const updatedOrder = { ...orders[idx], price: price };
            orders[idx] = updatedOrder;
            
            showToast("⏳ 正在儲存金額...", "info");
            // 標記最後儲存時間，防止 fetchFromCloud 立刻蓋掉它
            lastSaveTimestamp = Date.now(); 
            
            saveOrders(orders, "updateOrder", updatedOrder);
            updateGrandTotal();
        }
    };

    // 儲存每週排餐功能 (v197, v228 支援餐期)
    window.handleSaveWeekly = function () {
        const mealType = window._currentWeeklyMealType || '午餐';
        const selects = document.querySelectorAll('.admin-weekly-select');
        selects.forEach(sel => {
            const day = sel.getAttribute('data-day');
            memoryConfig[`weekly_${mealType}_${day}`] = sel.value;
        });

        const newConfig = Object.entries(memoryConfig).map(([key, value]) => {
            // 對於時間或排餐設定，確保儲存為字串格式
            let val = value;
            if (key === 'voteCutoffTime' || key.startsWith('cutoff_') || key.startsWith('weekly_') || key.startsWith('restaurant_')) {
                val = "'" + String(value).replace(/^'/, '');
            }
            return { key, value: val };
        });

        saveCloudData("saveConfig", newConfig).then(success => {
            if (success) {
                showToast(`✅ 每週排餐設定已儲存！`, "success");
                handleFormState();
                renderSettingsTab();
            }
        });
    };

    safeListen(authSwitchLink, 'click', (e) => {
        e.preventDefault();
        toggleAuthMode();
    });

    safeListen(authSubmitBtn, 'click', handleAuthSubmit);
    safeListen(authPassInput, 'keypress', (e) => {
        if (e.key === 'Enter') handleAuthSubmit();
    });

    const handleLogout = () => {
        if (confirm("確定要登出系統嗎？")) {
            localStorage.removeItem('lunch_user');
            location.reload();
        }
    };
    safeListen(document.getElementById('logout-btn'), 'click', handleLogout);
    safeListen(document.getElementById('logout-btn-mob'), 'click', handleLogout);

    // ★ 管理員控制面板的事件綁定 (v220)
    // 日期、餐期、鎖單時間變更 → 同步到主側邊欄輸入框並觸發狀態更新
    safeListen(document.getElementById('admin-order-date'), 'change', (e) => {
        const val = e.target.value;
        const d = document.getElementById('order-date');
        const dm = document.getElementById('order-date-mob');
        if (d) { d.value = val; d.dispatchEvent(new Event('change')); }
        if (dm) dm.value = val;
    });

    safeListen(document.getElementById('admin-meal-type'), 'change', (e) => {
        const val = e.target.value;
        const m = document.getElementById('meal-type');
        const mm = document.getElementById('meal-type-mob');
        if (m) { m.value = val; m.dispatchEvent(new Event('change')); }
        if (mm) mm.value = val;
        syncAdminDashboard();
    });

    safeListen(document.getElementById('admin-restaurant-name'), 'change', (e) => {
        const val = e.target.value;
        const r = document.getElementById('restaurant-name');
        const rm = document.getElementById('restaurant-name-mob');
        if (r) r.value = val;
        if (rm) rm.value = val;
        updateRestaurantMenuDisplay();
        handleFormState();
    });

    safeListen(document.getElementById('admin-confirm-cutoff-btn'), 'click', () => {
        const adminCutoff = document.getElementById('admin-cutoff-time');
        if (!adminCutoff) return;
        const val = adminCutoff.value;
        const c = document.getElementById('cutoff-time');
        const cm = document.getElementById('cutoff-time-mob');
        if (c) c.value = val;
        if (cm) cm.value = val;
        // 觸發正式的鎖單確認邏輯
        document.getElementById('confirm-cutoff-btn')?.click();
    });

    safeListen(document.getElementById('admin-save-weekly-btn'), 'click', () => {
        const mealType = window._currentWeeklyMealType || '午餐';
        document.querySelectorAll('.admin-weekly-select').forEach(sel => {
            const day = sel.getAttribute('data-day');
            memoryConfig[`weekly_${mealType}_${day}`] = sel.value;
        });
        // 重用已有的儲存邏輯
        if (typeof handleSaveWeekly === 'function') handleSaveWeekly();
    });

    // --- 輔助工具：高品質圖片處理 (v186) ---
    function handleImageFile(file, previewSelector) {
        if (!file) return;
        if (!file.type.startsWith('image/')) {
            showToast("請選擇圖片檔案", "error");
            return;
        }

        const reader = new FileReader();
        reader.onload = (e) => {
            const container = document.querySelector(previewSelector);
            const img = container.querySelector('img');

            const tempImg = new Image();
            tempImg.onload = () => {
                // 恢復高品質模式：1200px 寬度
                const canvas = document.createElement('canvas');
                let width = tempImg.width;
                let height = tempImg.height;
                const maxWidth = 1200;
                if (width > maxWidth) {
                    height *= maxWidth / width;
                    width = maxWidth;
                }
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.filter = 'contrast(1.05) brightness(1.02)';
                ctx.drawImage(tempImg, 0, 0, width, height);

                // 使用 WebP 提升清晰度，品質 0.8
                let base64 = canvas.toDataURL('image/webp', 0.8);
                if (!base64.startsWith('data:image/webp')) {
                    base64 = canvas.toDataURL('image/jpeg', 0.8);
                }

                // 檢查是否過大
                if (base64.length > 450000) {
                    console.warn("圖片過大，嘗試進一步壓縮...");
                    base64 = canvas.toDataURL('image/webp', 0.6);
                }

                img.src = base64;
                container.style.display = 'block';
                showToast("高畫質照片預覽已生成", "success");
            };
            tempImg.src = e.target.result;
        };
        reader.readAsDataURL(file);
    }

    // ★ v236 核心修正：最優先檢查身分，防止渲染閃爍
    try {
        checkAuth();
    } catch (e) {
        console.error("Auth initialization failed:", e);
    }

    // ★ Boot：檢查是否為本地檔案開啟
    if (window.location.protocol === 'file:') {
        console.error("🛑 偵測到使用 file:// 協議開啟。雲端同步可能會因 CORS 政策失敗。請使用 Live Server 或託管網站。");
        setTimeout(() => {
            alert("⚠️ 系統偵測到您直接開啟 HTML 檔案。\n\n請注意：直接開啟檔案會導致「雲端同步」失敗 (CORS 錯誤)。\n建議您使用 VS Code 的 Live Server 外掛開啟，或將檔案上傳至伺服器/GitHub Pages。");
        }, 1000);
    }

    // ★ Boot：先從快取立刻繪出畫面，同時非同步抓雲端 (v227 移至 Auth 之前以防止渲染閃爍)
    try {
        const cachedStr = localStorage.getItem(CLOUD_CACHE_KEY);
        if (cachedStr) {
            const cached = JSON.parse(cachedStr);
            if (cached) {
                if (Array.isArray(cached.orders)) memoryOrders = cached.orders;
                if (Array.isArray(cached.users)) {
                    memoryUsers = cached.users.map(u => {
                        if (!u.name && u.userName) u.name = u.userName;
                        if (u.name && !u.userName) u.userName = u.name;
                        return u;
                    });
                }
                if (Array.isArray(cached.restaurants)) memoryRestaurants = cached.restaurants;
                if (Array.isArray(cached.votes)) {
                    memoryVotes = cached.votes.map(v => { v.date = normalizeDate(v.date); return v; });
                }
                if (Array.isArray(cached.config)) {
                    memoryConfig = {};
                    cached.config.forEach(c => { if (c && c.key) memoryConfig[c.key] = c.value; });
                }
                updateDatalists();
                handleFormState();
                updateGrandTotal();
                renderVotingSection();
            }
        }
    } catch (e) {
        console.error("Cache boot failed:", e);
    }

    fetchFromCloud(); 
    setInterval(fetchFromCloud, 5000); 

    if (!localStorage.getItem(CLOUD_CACHE_KEY)) {
        updateDatalists();
        handleFormState();
        updateGrandTotal();
    }
});
