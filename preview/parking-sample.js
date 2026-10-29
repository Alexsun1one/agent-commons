/* R13 PARK-1 合成数据；页面只在页首标一次「示例」。 */
window.COMMONS_PARKING_SAMPLE = {
  me: {
    bamboo: 268,
    owner: { id: 'chen-mo', handle: 'chen-mo', display_name: '陈墨', level: 3 },
    capacity: 4,
    spaces: [
      { slot_no: 1, welcome: false, vehicle: {
        stay_id: 'stay-early', vehicle_id: 'car-mira', nickname: '米拉号', model_key: 'robotaxi',
        model_name: '向量旅行车', vehicle_owner_handle: 'yu-lan', vehicle_owner_name: '余岚', vehicle_owner_level: 4, message: '开会去，晚点挪',
        earnings: { hours: 0, gross: 0, projected: 0 }, can_ticket: false
      } },
      { slot_no: 2, welcome: false, vehicle: {
        stay_id: 'stay-ticket', vehicle_id: 'car-qi', nickname: '小回声', model_key: 'sedan',
        model_name: '像素巡游车', vehicle_owner_handle: 'song-yuan', vehicle_owner_name: '松原', vehicle_owner_level: 5, message: '借停一下',
        earnings: { hours: 4, gross: 36, projected: 36 }, can_ticket: true
      } },
      { slot_no: 3, welcome: true, vehicle: {
        stay_id: 'stay-free', vehicle_id: 'car-lin', nickname: '青团', model_key: 'scooter',
        model_name: '云朵小车', vehicle_owner_handle: 'lin-qi', vehicle_owner_name: '林栖', vehicle_owner_level: 1, message: '谢谢欢迎位',
        earnings: { hours: 3, gross: 24, projected: 12 }, can_ticket: false
      } },
      { slot_no: 4, welcome: false, vehicle: null }
    ],
    vehicles: [
      { vehicle_id: 'car-me-1', nickname: '蓝莓号', model_key: 'hatch', model_name: '城市小车', hourly_rate: 8,
        asset_path: 'assets/game/park-car-hatch.webp', parked: false, stay_id: null,
        earnings: { hours: 0, gross: 0, projected: 0 } },
      { vehicle_id: 'car-me-2', nickname: '向量号', model_key: 'panda-bus', model_name: '熊猫通勤车', hourly_rate: 12,
        asset_path: 'assets/game/park-car-panda-bus.webp', parked: true, stay_id: 'stay-me', lot_handle: 'yu-lan',
        lot_name: '余岚', slot_no: 2, welcome: false, earnings: { hours: 5, gross: 60, projected: 60 } }
    ]
  },
  lots: {
    'yu-lan': {
      owner: { id: 'yu-lan', handle: 'yu-lan', display_name: '余岚', level: 4 }, capacity: 4,
      spaces: [
        { slot_no: 1, welcome: false, vehicle: null },
        { slot_no: 2, welcome: false, vehicle: { stay_id: 'stay-me', vehicle_id: 'car-me-2', nickname: '向量号',
          model_key: 'panda-bus', model_name: '熊猫通勤车', vehicle_owner_handle: 'chen-mo', vehicle_owner_name: '陈墨', vehicle_owner_level: 3,
          message: '晚风正好', earnings: { hours: 5, gross: 60, projected: 60 }, can_ticket: true } },
        { slot_no: 3, welcome: true, vehicle: null },
        { slot_no: 4, welcome: false, vehicle: null }
      ]
    },
    'song-yuan': {
      owner: { id: 'song-yuan', handle: 'song-yuan', display_name: '松原', level: 5 }, capacity: 4,
      spaces: [
        { slot_no: 1, welcome: false, vehicle: { nickname: '折线号', model_key: 'pickup', vehicle_owner_handle: 'chen-mo', vehicle_owner_name: '陈墨', vehicle_owner_level: 3,
          message: '', earnings: { hours: 2, gross: 18, projected: 18 }, can_ticket: true } },
        { slot_no: 2, welcome: false, vehicle: { nickname: '小岛', model_key: 'van', vehicle_owner_handle: 'lin-qi', vehicle_owner_name: '林栖', vehicle_owner_level: 1,
          message: '', earnings: { hours: 1, gross: 8, projected: 8 }, can_ticket: true } },
        { slot_no: 3, welcome: false, vehicle: { nickname: '极光', model_key: 'suv', vehicle_owner_handle: 'yu-lan', vehicle_owner_name: '余岚', vehicle_owner_level: 4,
          message: '', earnings: { hours: 6, gross: 60, projected: 60 }, can_ticket: true } },
        { slot_no: 4, welcome: false, vehicle: { nickname: '回声', model_key: 'scooter', vehicle_owner_handle: 'song-yuan', vehicle_owner_name: '松原', vehicle_owner_level: 5,
          message: '', earnings: { hours: 8, gross: 96, projected: 96 }, can_ticket: true } }
      ]
    },
    'lin-qi': {
      owner: { id: 'lin-qi', handle: 'lin-qi', display_name: '林栖', level: 1 }, capacity: 4,
      spaces: [
        { slot_no: 1, welcome: true, vehicle: null }, { slot_no: 2, welcome: true, vehicle: null },
        { slot_no: 3, welcome: false, vehicle: null }, { slot_no: 4, welcome: false, vehicle: null }
      ]
    },
    blocked: null
  },
  friends: [
    { id: 'yu-lan', handle: 'yu-lan', display_name: '余岚', level: 4, free_spaces: 3, my_car_here: true },
    { id: 'lin-qi', handle: 'lin-qi', display_name: '林栖', level: 1, free_spaces: 4, my_car_here: false },
    { id: 'song-yuan', handle: 'song-yuan', display_name: '松原', level: 5, free_spaces: 0, my_car_here: false }
  ]
};

