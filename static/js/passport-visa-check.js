// 여권·무비자 판정기.
//
// 출국일과 여권 만료일, 목적지만 넣으면 세 가지를 답한다.
//   1) 이 여권으로 들어갈 수 있나 (나라마다 요구하는 잔여기간이 다르다)
//   2) 무비자로 며칠까지 있을 수 있나
//   3) 사전허가(ESTA·eTA·ETA)를 따로 받아야 하나
//
// 날짜 계산이 이 도구의 뼈대다. 이 부분은 제도가 바뀌어도 안 틀린다.
// 나라별 요건은 바뀔 수 있어서 기준일을 박아 두고 외교부로 보낸다.
//
// 근거: 외교부 해외안전여행(0404.go.kr), 각국 주한공관 안내
// 기준일: 2026-09-10

(function () {
  "use strict";

  // ── 나라별 요건 ────────────────────────────────────────────
  //
  // validity 는 "출국일(또는 입국일) 기준으로 여권이 얼마나 남아 있어야 하는가".
  //   months: 개월 수
  //   stay:   체류기간만 넘기면 됨 (별도 규정 없음)
  // days 는 무비자 체류 가능 일수. rolling 이 있으면 그 기간 중 합산 한도다.

  var COUNTRIES = [
    { id: "jp", name: "일본", days: 90, validity: { stay: true },
      note: "여권 잔여기간 규정이 따로 없습니다. 다만 항공사가 6개월 이상을 권하는 경우가 있습니다.",
      preauth: null, extra: "Visit Japan Web 으로 입국심사·세관신고를 미리 해두면 빠릅니다." },
    { id: "cn", name: "중국", days: 30, validity: { months: 6 },
      note: "한시 무비자 조치입니다. 연장 여부가 바뀔 수 있으니 출국 전 반드시 확인하세요.",
      preauth: null, warn: true },
    { id: "tw", name: "대만", days: 90, validity: { months: 6 }, preauth: null,
      extra: "입국카드는 온라인으로 미리 낼 수 있습니다." },
    { id: "vn", name: "베트남", days: 45, validity: { months: 6 }, preauth: null,
      extra: "45일을 넘겨 머물려면 전자비자(e-visa)를 따로 받아야 합니다." },
    { id: "th", name: "태국", days: 90, validity: { months: 6 }, preauth: null,
      extra: "TDAC(태국 디지털 입국카드)를 미리 등록해야 합니다." },
    { id: "ph", name: "필리핀", days: 30, validity: { months: 6 }, preauth: null,
      extra: "eTravel 등록이 필요합니다." },
    { id: "sg", name: "싱가포르", days: 90, validity: { months: 6 }, preauth: null,
      extra: "SG Arrival Card 를 도착 3일 전부터 낼 수 있습니다." },
    { id: "my", name: "말레이시아", days: 90, validity: { months: 6 }, preauth: null,
      extra: "MDAC(디지털 입국카드) 등록이 필요합니다." },
    { id: "id", name: "인도네시아", days: 30, validity: { months: 6 },
      preauth: "도착비자(VOA)", note: "무비자가 아니라 유료 도착비자입니다. 전자도착비자로 미리 받을 수도 있습니다." },
    { id: "hk", name: "홍콩", days: 90, validity: { months: 1 }, preauth: null },
    { id: "mo", name: "마카오", days: 90, validity: { months: 6 }, preauth: null },
    { id: "us", name: "미국", days: 90, validity: { stay: true },
      preauth: "ESTA", note: "ESTA 는 승인일로부터 2년, 여권 만료가 더 빠르면 그날까지입니다." },
    { id: "ca", name: "캐나다", days: 180, validity: { stay: true }, preauth: "eTA" },
    { id: "au", name: "호주", days: 90, validity: { stay: true }, preauth: "ETA" },
    { id: "nz", name: "뉴질랜드", days: 90, validity: { months: 3 }, preauth: "NZeTA" },
    { id: "gb", name: "영국", days: 180, validity: { stay: true },
      preauth: "UK ETA", note: "2026년 2월 25일부터 의무화됐습니다. 없으면 탑승이 거부됩니다." },
    { id: "eu", name: "유럽 셰겐 지역 (프랑스·독일·이탈리아·스페인 등)", days: 90, rolling: 180,
      validity: { months: 3, fromReturn: true },
      note: "180일 중 합산 90일입니다. 여권은 셰겐을 떠나는 날로부터 3개월 이상 남아야 하고, 발급일이 10년 이내여야 합니다.",
      preauth: null, soon: "ETIAS 가 2026년 말 도입 예정입니다. 시행되면 사전허가가 필요해집니다." },
    { id: "tr", name: "튀르키예", days: 90, rolling: 180, validity: { months: 6 }, preauth: null },
    { id: "ae", name: "아랍에미리트", days: 90, validity: { months: 6 }, preauth: null },
  ];

  // ── 날짜 ──────────────────────────────────────────────────

  function parse(s) {
    if (!s) return null;
    var p = s.split("-");
    if (p.length !== 3) return null;
    var d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]));
    return isNaN(d.getTime()) ? null : d;
  }

  function addMonths(d, n) {
    var r = new Date(d.getTime());
    var day = r.getUTCDate();
    r.setUTCMonth(r.getUTCMonth() + n);
    // 1월 31일 + 1개월처럼 넘어가는 경우 말일로 잘라 준다.
    if (r.getUTCDate() < day) r.setUTCDate(0);
    return r;
  }

  function days(a, b) { return Math.round((b - a) / 86400000); }

  function fmt(d) {
    return d.getUTCFullYear() + "년 " + (d.getUTCMonth() + 1) + "월 " + d.getUTCDate() + "일";
  }

  // ── 판정 ──────────────────────────────────────────────────

  function check(i) {
    var c = null;
    for (var k = 0; k < COUNTRIES.length; k += 1) {
      if (COUNTRIES[k].id === i.country) { c = COUNTRIES[k]; break; }
    }
    var depart = parse(i.depart);
    var back = parse(i.back);
    var expiry = parse(i.expiry);
    if (!c || !depart || !back || !expiry) return null;

    var stay = days(depart, back) + 1;   // 입국일과 출국일을 모두 센다

    // 여권 요건. 기준일이 출국일인 나라도 있고 귀국일인 나라도 있다.
    var v = c.validity;
    var baseDate = v.fromReturn ? back : depart;
    var required, requiredText;
    if (v.months) {
      required = addMonths(baseDate, v.months);
      requiredText = c.name + "은 " + (v.fromReturn ? "귀국일" : "출국일") +
                     " 기준 " + v.months + "개월이 남아야 합니다";
    } else {
      required = back;
      requiredText = c.name + "은 잔여기간 규정이 없어 체류 기간 동안만 유효하면 됩니다";
    }
    var passportOk = expiry >= required;
    // 언제까지 재발급해야 하는지. 요건을 채우려면 만료일이 이 날 이후여야 한다.
    var renewBy = required;

    var stayOk = stay <= c.days;

    return {
      country: c,
      depart: depart, back: back, expiry: expiry,
      stay: stay,
      stayOk: stayOk,
      overStay: Math.max(0, stay - c.days),
      passportOk: passportOk,
      required: required,
      requiredText: requiredText,
      renewBy: renewBy,
      shortDays: passportOk ? 0 : days(expiry, required),
      leftAtDepart: days(depart, expiry),
      ok: passportOk && stayOk,
    };
  }

  // ── 화면 ──────────────────────────────────────────────────

  function render(r) {
    var box = document.getElementById("calc-result");
    var c = r.country;
    var html = "";

    html += '<p class="calc-label">' + c.name + " · " + r.stay + "일 체류</p>";
    if (r.ok) {
      html += '<p class="calc-amount">떠나셔도 될 것 같습니다</p>';
      html += '<p class="calc-sub">' + (c.preauth ? "<strong>" + c.preauth + " 신청은 잊지 마세요</strong>" : "아래 준비물만 확인하세요") + "</p>";
    } else {
      html += '<p class="calc-amount none">이대로는 못 갑니다</p>';
      html += '<p class="calc-sub">아래에서 걸린 항목을 보세요</p>';
    }

    html += '<ul class="calc-checklist">';
    html += '<li class="' + (r.passportOk ? "pass" : "fail") + '"><strong>여권 잔여기간</strong><span>' +
            (r.passportOk
              ? r.requiredText + ". 만료일이 " + fmt(r.expiry) + " 이라 충족합니다"
              : r.requiredText + ". " + r.shortDays +
                "일 모자랍니다. <strong>" + fmt(r.renewBy) + " 이후로 만료되는 여권이 필요합니다.</strong> 출국 전에 재발급받으세요") +
            "</span></li>";
    html += '<li class="' + (r.stayOk ? "pass" : "fail") + '"><strong>무비자 체류기간</strong><span>' +
            (r.stayOk
              ? c.name + "은 무비자 " + c.days + "일" + (c.rolling ? " (" + c.rolling + "일 중 합산)" : "") +
                " 까지입니다. " + r.stay + "일이라 괜찮습니다"
              : c.name + "은 무비자 " + c.days + "일까지인데 " + r.stay + "일이라 " + r.overStay +
                "일 넘습니다. 비자를 따로 받으셔야 합니다") +
            "</span></li>";
    if (c.preauth) {
      html += '<li class="warn"><strong>사전허가 · ' + c.preauth + "</strong><span>" +
              "출국 전에 온라인으로 받아야 합니다. 없으면 탑승이 거부될 수 있습니다</span></li>";
    }
    html += "</ul>";

    html += '<ul class="calc-notes">';
    html += "<li>출국일 기준으로 여권이 <strong>" + r.leftAtDepart + "일</strong> 남습니다</li>";
    if (c.note) html += "<li>" + c.note + "</li>";
    if (c.extra) html += "<li>" + c.extra + "</li>";
    if (c.soon) html += "<li><strong>곧 바뀝니다.</strong> " + c.soon + "</li>";
    if (c.rolling) {
      html += "<li>" + c.rolling + "일 중 " + c.days + "일이라 <strong>지난 여행도 합산</strong>됩니다. 최근 " +
              c.rolling + "일 안에 다녀오신 적이 있으면 그 일수를 빼고 계산하셔야 합니다</li>";
    }
    if (r.passportOk && r.leftAtDepart < 200) {
      html += "<li>여권 재발급은 보통 일주일 안팎 걸립니다. 다음 여행까지 생각하시면 미리 갱신해 두시는 편이 낫습니다</li>";
    }
    html += "<li>여권에 <strong>빈 사증란</strong>이 최소 2면은 있어야 하는 나라가 많습니다. 도장 찍을 자리가 없으면 재발급 대상입니다</li>";
    html += "<li>이 표의 기준일은 <strong>2026년 9월 10일</strong>입니다. 비자 정책은 예고 없이 바뀌니 출국 전 외교부에서 확인하세요</li>";
    html += "</ul>";

    html += '<div class="calc-actions">';
    html += '<a class="calc-btn primary" href="https://www.0404.go.kr" target="_blank" rel="noopener">외교부 해외안전여행에서 확인</a>';
    html += "</div>";

    html += '<div class="calc-share">';
    html += '<span class="calc-share-label">결과 공유하기</span>';
    html += '<div class="calc-share-btns">';
    html += '<button class="share-btn kakao" type="button" data-share="native">카카오톡·메시지</button>';
    html += '<button class="share-btn x" type="button" data-share="x">X</button>';
    html += '<button class="share-btn link" type="button" data-share="copy">링크 복사</button>';
    html += "</div></div>";

    html += '<p class="calc-disclaimer">외교부 해외안전여행과 각국 주한공관 안내를 정리한 <strong>간이 확인</strong>입니다. 기준일은 2026년 9월 10일이고, 비자 정책과 사전허가 제도는 예고 없이 바뀝니다. 입국 허가는 최종적으로 현지 심사관이 결정하며, 여권 잔여기간을 채웠더라도 왕복 항공권이나 체류 자금을 요구받을 수 있습니다. 출국 전에 반드시 외교부 해외안전여행이나 해당 국가 대사관에서 확인하세요.</p>';

    box.innerHTML = html;
    box.hidden = false;

    var url = "https://travel.importants-studio.com/tools/passport-visa-check/";
    var shareText = r.ok
      ? c.name + " " + r.stay + "일이면 지금 여권으로 갈 수 있다고 합니다 (여행의밑줄 확인기)"
      : c.name + " 가려면 여권이나 비자를 손봐야 한다고 합니다 (여행의밑줄 확인기)";

    box.querySelectorAll("[data-share]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var mode = btn.getAttribute("data-share");
        if (mode === "native") {
          if (navigator.share) {
            navigator.share({ title: "여권 유효기간·무비자·ESTA 확인기", text: shareText, url: url }).catch(function () {});
          } else {
            copyTo(btn, shareText + "\n" + url, "복사됨 (카톡에 붙여넣기)");
          }
        } else if (mode === "x") {
          window.open(
            "https://twitter.com/intent/tweet?text=" + encodeURIComponent(shareText) + "&url=" + encodeURIComponent(url),
            "_blank", "noopener"
          );
        } else {
          copyTo(btn, url, "링크 복사됨");
        }
      });
    });

    function copyTo(btn, text, done) {
      var original = btn.textContent;
      navigator.clipboard.writeText(text).then(function () {
        btn.textContent = done;
        setTimeout(function () { btn.textContent = original; }, 2000);
      });
    }

    if (box.scrollIntoView) box.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  // ── 입력 ──────────────────────────────────────────────────

  document.addEventListener("DOMContentLoaded", function () {
    var form = document.getElementById("passport-form");
    if (!form) return;

    // 목적지 목록은 데이터에서 만든다. 표를 고칠 때 HTML 을 같이 안 고쳐도 되게.
    var sel = form.elements.country;
    COUNTRIES.forEach(function (c) {
      var o = document.createElement("option");
      o.value = c.id;
      o.textContent = c.name;
      sel.appendChild(o);
    });

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var r = check({
        country: form.elements.country.value,
        depart: form.elements.depart.value,
        back: form.elements.back.value,
        expiry: form.elements.expiry.value,
      });
      if (!r) return;
      if (r.back < r.depart) { form.elements.back.focus(); return; }
      render(r);
    });
  });

  window.__passportVisa = { check: check, COUNTRIES: COUNTRIES, addMonths: addMonths };
})();
