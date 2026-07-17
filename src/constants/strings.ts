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

// ── HomeScreen ──
export const HOME_GREETING_LATE_NIGHT = "🌙 夜深了，记得休息";
export const HOME_GREETING_MORNING = "☀️ 早上好，今天有物理课";
export const HOME_GREETING_NOON = "🌞 中午好，吃完饭再学习吧";
export const HOME_GREETING_AFTERNOON = "🌤️ 下午好，继续加油";
export const HOME_GREETING_EVENING = "🌙 晚上好，今天辛苦了";
export const HOME_LOGOUT = "登出";
export const HOME_EMPTY_NOTICE = "开始你的第一条笔记吧";
export const HOME_CARD_TODO = "TODO";
export const HOME_CARD_ACTIVE = "完成度追踪";
export const HOME_CARD_ALL = "全部笔记";
export const HOME_NOTICE_TODO = (count: number) =>
  `💡 你有 ${count} 条待办事项还没处理`;
export const HOME_NOTICE_RECENT = (dateLabel: string) =>
  `💡 最近的笔记更新于 ${dateLabel}`;
export const HOME_FAB_A11Y = "新建笔记";
export const HOME_ERROR_HINT_PREFIX = "⚠️ ";
export const HOME_NOTICE_MODAL_TITLE = "Zentrim 提示";
export const HOME_NOTICE_MODAL_BLANK = "暂时没有需要关注的提示";
export const HOME_NOTICE_BTN_EXPAND = "展开看看";
export const HOME_NOTICE_BTN_ATTACH = "加入附录";
export const HOME_NOTICE_BTN_OK = "OK";
export const HOME_NOTICE_ATTACH_TITLE = "已加入附录";
export const HOME_NOTICE_ATTACH_BODY = "这条提示已加入今天的附录。";
export const HOME_NOTICE_OK_TEXT = "好的";
export const HOME_ALL_NOTES_TITLE = (count: number) => `全部笔记 · ${count}`;
export const HOME_ALL_NOTES_CLOSE = "关闭";
export const HOME_ALL_NOTES_EMPTY = "暂无笔记，点击 ＋ 开始第一条";
export const HOME_NOTICE_FALLBACK_BODY = "暂时没有需要关注的提示";
export const HOME_TODO_DEV_HINT = "待办功能开发中";
export const HOME_ACTIVE_DEV_HINT = "完成度追踪开发中";
export const HOME_DEV_ALERT_TITLE = "提示";
export const HOME_OK = "知道了";
export const HOME_DEV_ALERT = "功能开发中";
export const HOME_OPERATION_FAIL = "操作失败";
export const HOME_DELETE_TITLE = "删除笔记";
export const HOME_DELETE_BODY = "确定删除？删除后不可恢复。";
export const HOME_DELETE_BTN = "删除";
export const HOME_CANCEL = "取消";
export const HOME_ACTION_ARCHIVE = "📦 归档";
export const HOME_ACTION_DELETE = "🗑️ 删除";
export const HOME_ACTION_CANCEL = "取消";
export const HOME_EMPTY_TITLE = "(无标题)";

// ── ChatListScreen ──
export const CHAT_TITLE = "💬 聊天";
export const CHAT_NEW_BTN = "＋";
export const CHAT_NEW_A11Y = "新建聊天";
export const CHAT_TAB_PRIVATE = "私聊";
export const CHAT_TAB_GROUP = "群聊";
export const CHAT_DEFAULT_TOPIC = "新对话";
export const CHAT_MESSAGE_COUNT_SUFFIX = (n: number) => `${n} 条`;
export const CHAT_REFRESH_HINT = "点此刷新";
export const CHAT_REFRESHING = "刷新中…";
export const CHAT_EMPTY_PRIVATE = "还没有聊天记录";
export const CHAT_EMPTY_PRIVATE_HINT = "点右上角 + 开始一次新对话";
export const CHAT_EMPTY_GROUP = "还没有群聊";
export const CHAT_EMPTY_GROUP_HINT = "点此刷新";
export const CHAT_REFRESH_BTN = "刷新";
export const CHAT_GROUP_COUNT = (n: number | string) => `👥 ${n}人`;
