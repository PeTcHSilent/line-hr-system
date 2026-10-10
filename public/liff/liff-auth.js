/**
 * liff-auth.js — แนบ LINE ID Token ไปกับทุก request ที่ยิงหา /api/
 *
 * ทำไมต้องทำแบบ patch window.fetch:
 *   หน้า LIFF ทั้ง 8 หน้ามี fetch() กระจายอยู่หลายสิบจุด
 *   ถ้าไปแก้ทีละจุดจะพลาดง่ายและแก้ยากเวลาเพิ่มหน้าใหม่
 *   patch ที่ตัว fetch ครั้งเดียว ครอบทุก request อัตโนมัติ รวมถึงโค้ดที่เขียนเพิ่มทีหลัง
 *
 * วิธีใช้ในหน้า LIFF:
 *   <script src="/liff/liff-auth.js"></script>   ← วางไว้หลัง LIFF SDK
 *   ...
 *   await liff.init({ liffId });
 *   await attachLiffIdToken();                   ← เรียกทันทีหลัง init
 *
 * ❗ ต้องเปิด scope "openid" ใน LIFF app ไม่งั้น liff.getIDToken() คืน null
 */
(function () {
  'use strict';

  var _idToken = null;
  var _origFetch = window.fetch.bind(window);

  function isApiCall(url) {
    try {
      // รับได้ทั้ง '/api/x', 'api/x' และ URL เต็มที่เป็น origin เดียวกัน
      var u = new URL(url, window.location.href);
      return u.origin === window.location.origin && u.pathname.indexOf('/api/') === 0;
    } catch (e) {
      return false;
    }
  }

  window.fetch = function (input, init) {
    var url = (typeof input === 'string') ? input
            : (input && input.url) ? input.url : '';

    if (!_idToken || !isApiCall(url)) return _origFetch(input, init);

    init = init || {};
    var headers = new Headers(init.headers || (input && input.headers) || {});
    // ใช้ header ไม่ใช่ query string — query string ไปโผล่ใน access log ของ server
    if (!headers.has('X-Line-Id-Token')) headers.set('X-Line-Id-Token', _idToken);

    return _origFetch(input, Object.assign({}, init, { headers: headers }));
  };

  /**
   * ดึง ID Token จาก LIFF มาเก็บไว้ ต้องเรียกหลัง liff.init() สำเร็จ
   * @returns {Promise<boolean>} true ถ้าได้ token มา
   */
  window.attachLiffIdToken = async function () {
    try {
      if (typeof liff === 'undefined' || !liff.getIDToken) return false;
      var t = liff.getIDToken();
      if (!t) {
        // สาเหตุที่พบบ่อยสุดคือ LIFF app ไม่ได้เปิด scope openid
        console.warn('[liff-auth] getIDToken() คืน null — ตรวจว่า LIFF app เปิด scope "openid" แล้วหรือยัง');
        return false;
      }
      _idToken = t;
      return true;
    } catch (e) {
      console.warn('[liff-auth] ดึง ID Token ไม่สำเร็จ:', e && e.message);
      return false;
    }
  };
})();
