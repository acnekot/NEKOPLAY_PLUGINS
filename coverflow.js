// @id coverflow
// @name 3D 封面墙
// @type feature
// @feature coverflow
// @version 1.1.0
// @author NEKOPLAY
// @desc 经典 3D 透视封面墙（外包透明 CD 塑料壳、镜面倒影、鼠标与陀螺仪 3D 随动、点击 3D 旋身翻盖放大看完整曲目；手机横屏自动进入）
// @api 1

nk.registerFeature({
  manifest() {
    return {
      type: 'feature',
      feature: 'coverflow',
      autoLandscape: true,
      navEntry: true,
    };
  },
  action() {
    return {
      open: 'coverflow',
      message: '已打开 3D 封面墙',
    };
  },
});
