/**
 * Script chuyển dữ liệu localStorage → Firestore
 * Chạy trong browser console (admin.html) sau khi đăng nhập
 *
 * Cách dùng:
 *   1. Mở admin.html, đăng nhập
 *   2. Mở DevTools → Console
 *   3. Copy paste toàn bộ script này → Enter
 *   4. Chờ thông báo "Migration hoàn tất"
 *
 * Script này an toàn: chỉ GHI THÊM vào Firestore, không xóa localStorage
 */

(async function migrateToFirestore() {
  console.log('=== AMZ Migration: localStorage → Firestore ===');

  if (typeof firebase === 'undefined') {
    console.error('❌ Firebase chưa được khởi tạo. Hãy mở script này trong admin.html');
    return;
  }
  if (!firebase.auth().currentUser) {
    console.error('❌ Chưa đăng nhập. Vui lòng đăng nhập trước.');
    return;
  }

  const db = firebase.firestore();
  const DB_KEY = 'amz_admin';

  // 1. Đọc dữ liệu từ localStorage
  let localData;
  try {
    localData = JSON.parse(localStorage.getItem(DB_KEY));
    if (!localData) { console.warn('⚠ Không có dữ liệu trong localStorage. Có thể đã migrate rồi.'); return; }
  } catch(e) {
    console.error('❌ Không đọc được localStorage:', e);
    return;
  }

  const players       = localData.players       || [];
  const tournaments   = localData.tournaments   || [];
  const registrations = localData.registrations || [];
  const history       = localData.history       || [];

  console.log(`📊 Dữ liệu cần migrate:`);
  console.log(`   • ${players.length} vận động viên`);
  console.log(`   • ${tournaments.length} giải đấu`);
  console.log(`   • ${registrations.length} đăng ký thi đấu`);
  console.log(`   • ${history.length} lịch sử`);

  const confirm = window.confirm(
    `Migrate dữ liệu sang Firestore?\n\n` +
    `• ${players.length} VĐV\n` +
    `• ${tournaments.length} giải đấu\n` +
    `• ${registrations.length} đăng ký\n\n` +
    `Thao tác này KHÔNG xóa dữ liệu localStorage.`
  );
  if (!confirm) { console.log('↩ Đã hủy.'); return; }

  // 2. Ghi vào settings/adminData (giữ nguyên cấu trúc cũ — backward compatible)
  try {
    console.log('🔄 Đang ghi dữ liệu chính vào settings/adminData...');
    await db.collection('settings').doc('adminData').set({
      players,
      tournaments,
      registrations,
      history,
      lastUpdated:  new Date().toISOString(),
      migratedAt:   new Date().toISOString(),
      migratedFrom: 'localStorage',
      version:      '1.0'
    });
    console.log('✅ settings/adminData — OK');
  } catch(e) {
    console.error('❌ Lỗi ghi settings/adminData:', e);
    return;
  }

  // 3. Ghi từng player vào /players collection (chuẩn bị cho Phase 2)
  if (players.length > 0) {
    console.log(`🔄 Đang migrate ${players.length} VĐV sang /players...`);
    const batch = db.batch();
    players.forEach(function(p) {
      const ref = db.collection('players').doc(p.id || db.collection('players').doc().id);
      batch.set(ref, {
        legacyId:   p.id || null,
        userId:     null,
        name:       p.name || '',
        phone:      p.phone || '',
        email:      p.email || '',
        photo:      p.photo || '',
        duprLevel:  parseFloat(p.level) || 2.0,
        elo:        1000,
        categories: ['Đơn nam'],
        tier:       p.tier || 'Khá',
        note:       p.note || '',
        isActive:   true,
        stats: {
          totalMatches:      0,
          wins:              0,
          losses:            0,
          tournamentsPlayed: 0,
          points:            Math.round((parseFloat(p.level) || 2) * 200)
        },
        createdAt:  p.createdAt  || new Date().toISOString(),
        updatedAt:  p.updatedAt  || new Date().toISOString()
      }, { merge: true });
    });
    try {
      await batch.commit();
      console.log(`✅ /players — ${players.length} VĐV đã migrate`);
    } catch(e) {
      console.error('❌ Lỗi migrate /players:', e);
    }
  }

  // 4. Ghi từng tournament vào /tournaments collection
  if (tournaments.length > 0) {
    console.log(`🔄 Đang migrate ${tournaments.length} giải đấu sang /tournaments...`);
    const batch2 = db.batch();
    tournaments.forEach(function(t) {
      const ref = db.collection('tournaments').doc(t.id || db.collection('tournaments').doc().id);
      batch2.set(ref, {
        legacyId:     t.id || null,
        name:         t.name || '',
        description:  t.note || '',
        date:         t.date || '',
        endDate:      t.date || '',
        type:         t.type || 'internal',
        format:       'single_elimination',
        status:       t.status || 'upcoming',
        categories:   t.levels ? t.levels.split(',').map(function(s) { return s.trim(); }) : [],
        maxTeamsPerCategory: parseInt(t.maxTeams) || 0,
        entryFee:     0,
        prize:        t.prize || '',
        venue:        '179 Thống Nhất, Phường Vũng Tàu, TP.HCM',
        image:        t.image || '',
        registrationDeadline: t.date || '',
        note:         t.note || '',
        organizer:    firebase.auth().currentUser.uid,
        createdAt:    t.createdAt || new Date().toISOString(),
        updatedAt:    t.updatedAt || new Date().toISOString()
      }, { merge: true });
    });
    try {
      await batch2.commit();
      console.log(`✅ /tournaments — ${tournaments.length} giải đấu đã migrate`);
    } catch(e) {
      console.error('❌ Lỗi migrate /tournaments:', e);
    }
  }

  // 5. Ghi registration history vào sub-collections
  if (registrations.length > 0) {
    console.log(`🔄 Đang migrate ${registrations.length} đăng ký...`);
    let regCount = 0;
    for (const reg of registrations) {
      const tournId = reg.tournamentId;
      if (!tournId) continue;
      try {
        await db.collection('tournaments').doc(tournId)
          .collection('registrations').doc(reg.id || db.collection('_').doc().id)
          .set({
            legacyId:     reg.id || null,
            playerId:     reg.playerId || '',
            playerName:   reg.playerName || '',
            partnerId:    null,
            partnerName:  '',
            category:     reg.category || '',
            status:       reg.status || 'confirmed',
            seed:         null,
            paymentId:    null,
            registeredAt: reg.registeredAt || new Date().toISOString(),
            updatedAt:    new Date().toISOString()
          }, { merge: true });
        regCount++;
      } catch(e) {
        console.warn('Bỏ qua reg lỗi:', reg.id, e.message);
      }
    }
    console.log(`✅ Registrations — ${regCount}/${registrations.length} đã migrate`);
  }

  // 6. Ghi appConfig mặc định
  try {
    const configRef = db.collection('settings').doc('appConfig');
    const existing = await configRef.get();
    if (!existing.exists) {
      await configRef.set({
        maintenanceMode:      false,
        bookingOpenHour:      5,
        bookingCloseHour:     23,
        priceWeekday:         100000,
        priceWeekend:         120000,
        maxBookingDaysAhead:  14,
        eloKFactor:           32,
        updatedAt:            new Date().toISOString(),
        updatedBy:            firebase.auth().currentUser.uid
      });
      console.log('✅ settings/appConfig — khởi tạo mặc định');
    } else {
      console.log('ℹ settings/appConfig — đã tồn tại, bỏ qua');
    }
  } catch(e) {
    console.warn('⚠ Không tạo được appConfig:', e.message);
  }

  console.log('');
  console.log('🎉 Migration hoàn tất!');
  console.log('');
  console.log('Các bước tiếp theo:');
  console.log('  1. Kiểm tra Firebase Console → Firestore để xác nhận dữ liệu');
  console.log('  2. Refresh admin.html và kiểm tra dữ liệu hiển thị đúng');
  console.log('  3. Sau khi xác nhận OK, dữ liệu localStorage sẽ dần không dùng nữa');

  alert('Migration hoàn tất!\n\nKiểm tra Firebase Console → Firestore để xác nhận.');
})();
