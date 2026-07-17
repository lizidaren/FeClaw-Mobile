/**
 * UI 字符串常量（集中管理，方便未来 i18n）
 * fix(P1-2): 所有界面可见文字统一定义在此
 */

// ── CanvasToolbar ──
export const TOOLBAR_PEN = "笔";
export const TOOLBAR_PEN_A11Y = "笔（双击换颜色）";
export const TOOLBAR_TEXT = "文字";
export const TOOLBAR_TEXT_A11Y = "切换到文字模式";
export const TOOLBAR_ERASER = "橡皮";
export const TOOLBAR_PHOTO = "拍照";
export const TOOLBAR_UNDO = "撤销";

// ── DraftToggle ──
export const DRAFT_ENTER_A11Y = "进入草稿模式";
export const DRAFT_EXIT_A11Y = "退出草稿模式";
export const DRAFT_ACTIVE = "草稿中";
export const DRAFT_INACTIVE = "草稿";

// ── RecordingBubble ──
export const RECORDING_ASR = "ASR";
export const RECORDING_AUDIO = "音轨";
export const RECORDING_PHOTOS = "照片";

// ── ThreeDotMenu ──
export const MENU_A11Y = "更多菜单";
export const MENU_CREATED_AT = "创建时间";
export const MENU_DEVICE = "采集设备";
export const MENU_VIEW_COUNT = "查看次数";
export const MENU_EDIT_DURATION = "编辑时长";
export const MENU_TIMELINE = "所属时间线";
export const MENU_TIMELINE_UNCATEGORIZED = "未归类";
export const MENU_CHANGE_TIMELINE = "更改所属时间线";
export const MENU_EXPORT_SVG = "导出为 SVG";
export const MENU_EXPORT_PNG = "导出为 PNG";
export const MENU_INSERT_FILE = "插入文件";
export const MENU_CANCEL = "取消";
export const MENU_COUNT_SUFFIX = " 次";
export const MENU_MINUTES_SUFFIX = " 分钟";

// ── PhotoCapture ──
export const PHOTO_A11Y = "拍照";

// ── PdfImportDialog ──
export const PDF_TITLE_PREFIX = "导入 PDF：";
export const PDF_ATTACH_LINK = "放个链接";
export const PDF_ATTACH_HINT = "作为附件挂到画布，点开查看";
export const PDF_EXPAND = "展开到画布";
export const PDF_EXPAND_HINT = "选择页面作为图片插入";
export const PDF_SELECTED_COUNT = (selected: number, total: number) =>
  `已选 ${selected} / ${total} 页`;
export const PDF_SELECT_ALL = "全选";
export const PDF_DESELECT_ALL = "取消全选";
export const PDF_PAGE_LABEL = (n: number) => `第 ${n} 页`;
export const PDF_BACK = "返回";
export const PDF_INSERT = (n: number) => `插入 ${n} 页`;

// ── CanvasScreen ──
export const COLOR_PANEL_TITLE = "选择颜色";
