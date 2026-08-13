/**
 * Tổng hợp số liệu Phòng Y tế - Ứng dụng Phòng Y tế - Firebase production 8.1.0
 *
 * Firebase Web config là thông tin cấu hình công khai của ứng dụng web,
 * không phải service-account secret. Tuyệt đối không đặt private key,
 * mật khẩu quản trị hoặc token bí mật trong GitHub.
 */
window.YTE_APP_CONFIG = Object.freeze({
  APP_NAME: 'Ứng dụng Phòng Y tế',
  ORGANIZATION: 'Trung tâm Bảo trợ xã hội Tân Hiệp',
  VERSION: '8.1.0',
  OWNER_EMAIL: 'thanhbds2011@gmail.com',
  FIREBASE: Object.freeze({
    apiKey: 'AIzaSyCDEcZZWhMbdNpDD6PEPmDgo68zo352jOU',
    authDomain: 'hsba-trung-tam-test.firebaseapp.com',
    databaseURL: 'https://hsba-trung-tam-test-default-rtdb.asia-southeast1.firebasedatabase.app',
    projectId: 'hsba-trung-tam-test',
    storageBucket: 'hsba-trung-tam-test.firebasestorage.app',
    messagingSenderId: '711784208666',
    appId: '1:711784208666:web:89c555a08ece8b7f44f4a3',
    measurementId: 'G-W8JYRQNQMB'
  })
});
