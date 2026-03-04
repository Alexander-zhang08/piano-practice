/**
 * ============ 钢琴练习打卡系统 - API 客户端 ============
 *
 * 文件路径: js/api.js
 *
 * 功能：
 * - 与 Bmob 云端通信
 * - 用户认证和会话管理
 * - 数据同步（上传/下载）
 * - 离线队列管理
 */

// ============ API 配置 ============

const API_CONFIG = {
  appId: 'YOUR_BMOB_APP_ID',           // TODO: 替换为你的 Bmob Application ID
  restApiKey: 'YOUR_BMOB_REST_API_KEY', // TODO: 替换为你的 REST API Key
  baseUrl: 'https://api.bmob.cn/v1',
  timeout: 10000 // 请求超时时间（毫秒）
};

// ============ 本地存储 Keys ==========

const STORAGE_KEYS = {
  USER_TOKEN: 'pianoUserToken',
  SYNC_QUEUE: 'pianoSyncQueue',
  LAST_SYNC: 'pianoLastSync'
};

// ============ API 客户端类 ============

class PianoTrackerAPI {
  constructor(config) {
    this.config = config;
    this.currentUser = null;
    this.syncQueue = [];
    this.isSyncing = false;
    this.loadUserToken();
  }

  /**
   * 构建请求头
   */
  getHeaders() {
    return {
      'Content-Type': 'application/json',
      'X-Bmob-Application-Id': this.config.appId,
      'X-Bmob-REST-API-Key': this.config.restApiKey
    };
  }

  /**
   * 通用 HTTP 请求方法
   */
  async request(method, path, data = null, timeout = this.config.timeout) {
    const url = `${this.config.baseUrl}${path}`;
    const options = {
      method,
      headers: this.getHeaders()
    };

    if (data) {
      options.body = JSON.stringify(data);
    }

    try {
      // 创建超时 Promise
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('请求超时')), timeout)
      );

      const fetchPromise = fetch(url, options).then(response => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        return response.json();
      });

      return await Promise.race([fetchPromise, timeoutPromise]);
    } catch (error) {
      console.error('API 请求失败:', {
        url,
        method,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * 加载保存的用户 token
   */
  loadUserToken() {
    const token = localStorage.getItem(STORAGE_KEYS.USER_TOKEN);
    if (token) {
      try {
        this.currentUser = JSON.parse(token);
      } catch (e) {
        console.warn('用户 token 无效，已清除');
        localStorage.removeItem(STORAGE_KEYS.USER_TOKEN);
      }
    }
  }

  /**
   * 保存用户 token
   */
  saveUserToken(user) {
    localStorage.setItem(STORAGE_KEYS.USER_TOKEN, JSON.stringify(user));
    this.currentUser = user;
  }

  /**
   * 清除用户 token
   */
  clearUserToken() {
    localStorage.removeItem(STORAGE_KEYS.USER_TOKEN);
    this.currentUser = null;
  }

  /**
   * 检查用户是否已登录
   */
  isLoggedIn() {
    return this.currentUser !== null;
  }

  // ========== 用户管理 API ==========

  /**
   * 注册用户
   */
  async register(username, password, email = '') {
    try {
      const result = await this.request('POST', '/functions/registerUser', {
        username,
        password,
        email
      });

      if (result.code === 0) {
        this.saveUserToken(result.data);
        return { success: true, message: '注册成功', user: result.data };
      } else {
        return { success: false, message: result.message };
      }
    } catch (error) {
      return {
        success: false,
        message: `注册失败: ${error.message}`
      };
    }
  }

  /**
   * 登录用户
   */
  async login(username, password) {
    try {
      const result = await this.request('POST', '/functions/loginUser', {
        username,
        password
      });

      if (result.code === 0) {
        this.saveUserToken(result.data);
        return { success: true, message: '登录成功', user: result.data };
      } else {
        return { success: false, message: result.message };
      }
    } catch (error) {
      return {
        success: false,
        message: `登录失败: ${error.message}`
      };
    }
  }

  /**
   * 登出
   */
  logout() {
    this.clearUserToken();
    this.syncQueue = [];
    localStorage.removeItem(STORAGE_KEYS.SYNC_QUEUE);
  }

  /**
   * 获取用户信息
   */
  async getUserInfo(username) {
    try {
      const result = await this.request('POST', '/functions/getUserInfo', {
        username
      });

      if (result.code === 0) {
        return result.data;
      } else {
        throw new Error(result.message);
      }
    } catch (error) {
      console.error('获取用户信息失败:', error);
      throw error;
    }
  }

  // ========== 打卡记录 API ==========

  /**
   * 保存打卡记录
   */
  async savePractice(date, pieces, totalTime) {
    if (!this.isLoggedIn()) {
      throw new Error('用户未登录');
    }

    try {
      const result = await this.request('POST', '/functions/savePractice', {
        username: this.currentUser.username,
        date,
        pieces,
        totalTime
      });

      if (result.code === 0) {
        return { success: true, data: result.data };
      } else {
        return { success: false, message: result.message };
      }
    } catch (error) {
      // 保存到同步队列
      this.addToSyncQueue({
        type: 'savePractice',
        params: { date, pieces, totalTime },
        timestamp: Date.now()
      });

      return {
        success: false,
        message: `保存失败（已加入同步队列）: ${error.message}`
      };
    }
  }

  /**
   * 获取打卡记录
   */
  async getPractices(limit = 100, skip = 0) {
    if (!this.isLoggedIn()) {
      throw new Error('用户未登录');
    }

    try {
      const result = await this.request('POST', '/functions/getPractices', {
        username: this.currentUser.username,
        limit,
        skip
      });

      if (result.code === 0) {
        return result.data || [];
      } else {
        throw new Error(result.message);
      }
    } catch (error) {
      console.warn('获取打卡记录失败（使用本地数据）:', error);
      return [];
    }
  }

  /**
   * 获取单日打卡
   */
  async getPracticeByDate(date) {
    if (!this.isLoggedIn()) {
      return null;
    }

    try {
      const result = await this.request('POST', '/functions/getPracticeByDate', {
        username: this.currentUser.username,
        date
      });

      if (result.code === 0) {
        return result.data;
      } else {
        return null;
      }
    } catch (error) {
      console.warn('获取单日打卡失败:', error);
      return null;
    }
  }

  /**
   * 删除打卡记录
   */
  async deletePractice(date) {
    if (!this.isLoggedIn()) {
      throw new Error('用户未登录');
    }

    try {
      const result = await this.request('POST', '/functions/deletePractice', {
        username: this.currentUser.username,
        date
      });

      if (result.code === 0) {
        return { success: true };
      } else {
        return { success: false, message: result.message };
      }
    } catch (error) {
      return {
        success: false,
        message: `删除失败: ${error.message}`
      };
    }
  }

  // ========== 曲目库 API ==========

  /**
   * 保存曲目库
   */
  async saveRepertoire(repertoire) {
    if (!this.isLoggedIn()) {
      throw new Error('用户未登录');
    }

    try {
      const result = await this.request('POST', '/functions/saveRepertoire', {
        username: this.currentUser.username,
        repertoire
      });

      if (result.code === 0) {
        return { success: true, data: result.data };
      } else {
        return { success: false, message: result.message };
      }
    } catch (error) {
      // 保存到同步队列
      this.addToSyncQueue({
        type: 'saveRepertoire',
        params: { repertoire },
        timestamp: Date.now()
      });

      return {
        success: false,
        message: `保存失败（已加入同步队列）: ${error.message}`
      };
    }
  }

  /**
   * 获取曲目库
   */
  async getRepertoire() {
    if (!this.isLoggedIn()) {
      return [];
    }

    try {
      const result = await this.request('POST', '/functions/getRepertoire', {
        username: this.currentUser.username
      });

      if (result.code === 0) {
        return result.data || [];
      } else {
        throw new Error(result.message);
      }
    } catch (error) {
      console.warn('获取曲目库失败（使用本地数据）:', error);
      return [];
    }
  }

  // ========== 统计数据 API ==========

  /**
   * 获取统计数据
   */
  async getStatistics() {
    if (!this.isLoggedIn()) {
      return null;
    }

    try {
      const result = await this.request('POST', '/functions/getStatistics', {
        username: this.currentUser.username
      });

      if (result.code === 0) {
        return result.data;
      } else {
        return null;
      }
    } catch (error) {
      console.warn('获取统计数据失败:', error);
      return null;
    }
  }

  // ========== 离线同步队列 ==========

  /**
   * 添加到同步队列
   */
  addToSyncQueue(item) {
    this.syncQueue.push(item);
    this.saveSyncQueue();
    console.log(`已添加到同步队列 (${this.syncQueue.length})`);
  }

  /**
   * 保存同步队列到本地存储
   */
  saveSyncQueue() {
    localStorage.setItem(STORAGE_KEYS.SYNC_QUEUE, JSON.stringify(this.syncQueue));
  }

  /**
   * 从本地存储加载同步队列
   */
  loadSyncQueue() {
    const queue = localStorage.getItem(STORAGE_KEYS.SYNC_QUEUE);
    this.syncQueue = queue ? JSON.parse(queue) : [];
  }

  /**
   * 处理同步队列（恢复网络后调用）
   */
  async processSyncQueue() {
    if (this.isSyncing || this.syncQueue.length === 0 || !this.isLoggedIn()) {
      return;
    }

    this.isSyncing = true;
    console.log(`开始处理同步队列 (${this.syncQueue.length} 项)`);

    const failedItems = [];

    for (const item of this.syncQueue) {
      try {
        if (item.type === 'savePractice') {
          const { date, pieces, totalTime } = item.params;
          await this.savePractice(date, pieces, totalTime);
        } else if (item.type === 'saveRepertoire') {
          const { repertoire } = item.params;
          await this.saveRepertoire(repertoire);
        }
        console.log(`✅ 同步成功: ${item.type}`);
      } catch (error) {
        console.warn(`❌ 同步失败: ${item.type}`, error);
        failedItems.push(item);
      }
    }

    this.syncQueue = failedItems;
    this.saveSyncQueue();
    this.isSyncing = false;

    if (failedItems.length === 0) {
      console.log('✅ 所有项目同步完成');
    } else {
      console.warn(`⚠️ ${failedItems.length} 项同步失败，稍后重试`);
    }
  }

  // ========== 工具方法 ==========

  /**
   * 检查网络连接
   */
  async checkConnection() {
    try {
      const response = await fetch('https://api.bmob.cn/health', {
        timeout: 5000
      });
      return response.ok;
    } catch (error) {
      return false;
    }
  }

  /**
   * 监听网络状态变化
   */
  watchNetworkStatus(callback) {
    // 在线
    window.addEventListener('online', () => {
      console.log('✅ 网络已连接');
      callback(true);
      this.processSyncQueue();
    });

    // 离线
    window.addEventListener('offline', () => {
      console.log('❌ 网络已断开');
      callback(false);
    });

    // 初始状态
    callback(navigator.onLine);
  }
}

// ============ 全局实例 ============

// 创建全局 API 实例
const api = new PianoTrackerAPI(API_CONFIG);

// 监听网络状态
api.watchNetworkStatus((isOnline) => {
  const statusEl = document.getElementById('networkStatus');
  if (statusEl) {
    statusEl.innerHTML = isOnline ? '📡 在线' : '📴 离线';
    statusEl.style.color = isOnline ? '#4CAF50' : '#FF9800';
  }
});

// 自动重试离线队列（每30秒）
setInterval(() => {
  if (navigator.onLine) {
    api.processSyncQueue().catch(console.error);
  }
}, 30000);
