import type { TuTienGameState, RuleResult } from './rules-engine';

function rngChoice<T>(rng: () => number, arr: T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}

export class StoryDirector {
  constructor(private rng: () => number = Math.random) {}

  opening(state: TuTienGameState) {
    const { player: p, world: w } = state;
    return {
      title: 'Mở đầu — Một bước vào tiên lộ',
      story: `Năm ${w.year}, tại ${w.region}, linh khí suy mà chưa tuyệt. ${p.name}, xuất thân ${p.origin.toLowerCase()}, mang ${p.spiritRoot.toLowerCase()}, lần đầu thật sự đứng trước cánh cửa của giới tu hành.

Ba ngày trước, một lão đạo bị thương đã chết bên bờ suối. Trong hành lý của lão chỉ có một túi linh thạch nhỏ, một tấm bản đồ rách và bốn chữ viết bằng máu: "Đừng tin Thanh Vân".

Sáng nay, tiếng chuông tuyển đệ tử của Thanh Vân Tông vang từ phía bắc. Cùng lúc đó, tấm bản đồ trong tay ngươi lại chỉ về một khe núi bị dân địa phương gọi là Quỷ Khốc Cốc.`,
      choices: [
        'Đến Thanh Vân Tông tham gia tuyển đệ tử.',
        'Theo tấm bản đồ đi về Quỷ Khốc Cốc.',
        'Ở lại tìm hiểu thân phận của lão đạo trước khi hành động.',
      ],
    };
  }

  nextScene(state: TuTienGameState, action: string, result: RuleResult) {
    const p = state.player;
    const mood = result.success ? 'thuận lợi' : 'nguy hiểm';
    const notes = result.notes.join(' ');
    let loot = '';
    if (result.discovered.length > 0) {
      loot = ` Ngươi còn thu được: ${result.discovered.join(', ')}.`;
    }
    if (result.stonesDelta > 0) {
      loot += ` Túi trữ vật nặng thêm ${result.stonesDelta} linh thạch.`;
    }
    if (result.hpDelta < 0) {
      loot += ` Thương thế khiến sinh lực giảm ${Math.abs(result.hpDelta)} điểm.`;
    }

    const variants = [
      `Ngươi lựa chọn: ${action}. Kết quả ban đầu tỏ ra ${mood}. ${notes}${loot}`,
      `Không có thiên đạo nào bảo đảm lựa chọn của ngươi là đúng. Ngươi vẫn làm: ${action}. ${notes}${loot}`,
      `Giữa núi rừng nặng mùi linh khí ẩm lạnh, ngươi quyết định: ${action}. ${notes}${loot}`,
    ];
    let story = rngChoice(this.rng, variants);

    if (p.hp <= 0) {
      story += '\n\nÝ thức tan dần. Tiên lộ của đời này dừng lại ở đây.';
      return { title: 'Thân tử đạo tiêu', story, choices: [] };
    }

    const hooks = [
      'Một thiếu niên áo xám âm thầm quan sát ngươi từ xa.',
      'Trong túi đồ của ngươi, mảnh bản đồ cũ bỗng nóng lên.',
      'Tin đồn về một phiên chợ tu sĩ bí mật bắt đầu lan ra.',
      'Một con hạc giấy không rõ chủ nhân đáp xuống trước mặt ngươi.',
      'Đêm đó, phía chân trời xuất hiện một đạo kiếm quang dài hàng trăm trượng.',
    ];
    story += '\n\n' + rngChoice(this.rng, hooks);

    const choices = this._choicesForState(state);
    return { title: `Lượt ${state.turn} — ${p.realm}`, story, choices };
  }

  _choicesForState(state: TuTienGameState): string[] {
    const p = state.player;
    const choices: string[] = [];
    if (p.hp < 45) {
      choices.push(rngChoice(this.rng, [
        'Tìm hang đá kín gió để dưỡng thương, tránh mọi xung đột.',
        'Dùng linh thạch đổi đan dược tại phường thị rồi chữa trị vết thương.',
        'Lần theo dòng suối tìm linh thảo, ưu tiên khôi phục thương thế.',
      ]));
    } else {
      choices.push(rngChoice(this.rng, [
        'Theo dấu linh khí lạ vào khe núi để thám hiểm cơ duyên.',
        'Dò xét động phủ bỏ hoang vừa hiện ra sau màn sương.',
        'Khám phá vùng rừng cấm nơi bản đồ cũ đang phát sáng.',
      ]));
    }
    choices.push(rngChoice(this.rng, [
      'Tìm linh mạch yên tĩnh để tu luyện, củng cố căn cơ.',
      'Bế quan ngắn ngày, thử vận hành công pháp mới.',
      'Ngồi thiền bên hồ linh khí để tu luyện và ổn định tâm cảnh.',
    ]));
    choices.push(rngChoice(this.rng, [
      'Đến phường thị dò tin về hạc giấy và đổi vật tư cần thiết.',
      'Tới tông môn gần nhất hỏi thăm tung tích lão đạo bí ẩn.',
      'Nhận một nhiệm vụ tại phường thị để gây dựng danh tiếng.',
    ]));
    return choices.slice(0, 3);
  }
}
