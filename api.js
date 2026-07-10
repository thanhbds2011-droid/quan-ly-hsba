class HsbaApi {
  constructor(baseUrl) {
    this.baseUrl = String(baseUrl || '').trim();
  }

  isConfigured() {
    return /^https:\/\/script\.google\.com\/macros\/s\/.+\/exec$/i.test(this.baseUrl);
  }

  async get(action, params = {}) {
    this.#assertConfigured();

    const url = new URL(this.baseUrl);
    url.searchParams.set('action', action);
    url.searchParams.set('_t', Date.now());

    Object.entries(params).forEach(([key, value]) => {
      if (value !== '' && value !== undefined && value !== null) {
        url.searchParams.set(key, String(value));
      }
    });

    const response = await fetch(url.toString(), {
      method: 'GET',
      redirect: 'follow',
      cache: 'no-store'
    });

    return this.#parseResponse(response);
  }

  async post(action, payload = {}) {
    this.#assertConfigured();

    const response = await fetch(this.baseUrl, {
      method: 'POST',
      redirect: 'follow',
      headers: {
        'Content-Type': 'text/plain;charset=utf-8'
      },
      body: JSON.stringify({ action, ...payload })
    });

    return this.#parseResponse(response);
  }

  async uploadFile({ soHoSo, quyenSo, file }) {
    if (!file) throw new Error('Chưa chọn file.');

    if (file.size > window.HSBA_CONFIG.MAX_UPLOAD_BYTES) {
      throw new Error('File vượt quá dung lượng tối đa 10 MB.');
    }

    const base64Data = await this.#fileToBase64(file);

    return this.post('taiFileLen', {
      soHoSo,
      quyenSo,
      fileName: file.name,
      mimeType: file.type,
      base64Data
    });
  }

  #assertConfigured() {
    if (!this.isConfigured()) {
      throw new Error('Chưa cấu hình URL Apps Script trong config.js.');
    }
  }

  async #parseResponse(response) {
    if (!response.ok) {
      throw new Error(`Máy chủ phản hồi lỗi HTTP ${response.status}.`);
    }

    const text = await response.text();
    let result;

    try {
      result = JSON.parse(text);
    } catch {
      throw new Error(
        'Không đọc được dữ liệu JSON. Kiểm tra quyền triển khai Apps Script và URL /exec.'
      );
    }

    if (!result.success) {
      throw new Error(result.message || 'Không thực hiện được yêu cầu.');
    }

    return result;
  }

  #fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = () => {
        const value = String(reader.result || '');
        resolve(value.includes(',') ? value.split(',')[1] : value);
      };

      reader.onerror = () => reject(new Error('Không đọc được file.'));
      reader.readAsDataURL(file);
    });
  }
}

window.hsbaApi = new HsbaApi(window.HSBA_CONFIG.API_URL);
