// Material Symbols (rounded, weight 400) used by the UI, imported as raw SVG so only these end up in
// the bundle. Add a name here to use it with <Icon name="…" />.

import add from "@material-symbols/svg-400/rounded/add.svg?raw";
import adminPanel from "@material-symbols/svg-400/rounded/admin_panel_settings.svg?raw";
import arrowBack from "@material-symbols/svg-400/rounded/arrow_back.svg?raw";
import arrowDropDown from "@material-symbols/svg-400/rounded/arrow_drop_down.svg?raw";
import accountCircle from "@material-symbols/svg-400/rounded/account_circle.svg?raw";
import accountCircleFill from "@material-symbols/svg-400/rounded/account_circle-fill.svg?raw";
import check from "@material-symbols/svg-400/rounded/check.svg?raw";
import close from "@material-symbols/svg-400/rounded/close.svg?raw";
import computer from "@material-symbols/svg-400/rounded/computer.svg?raw";
import contentCopy from "@material-symbols/svg-400/rounded/content_copy.svg?raw";
import darkMode from "@material-symbols/svg-400/rounded/dark_mode.svg?raw";
import deleteIcon from "@material-symbols/svg-400/rounded/delete.svg?raw";
import devices from "@material-symbols/svg-400/rounded/devices.svg?raw";
import dns from "@material-symbols/svg-400/rounded/dns.svg?raw";
import edit from "@material-symbols/svg-400/rounded/edit.svg?raw";
import group from "@material-symbols/svg-400/rounded/group.svg?raw";
import groupFill from "@material-symbols/svg-400/rounded/group-fill.svg?raw";
import history from "@material-symbols/svg-400/rounded/history.svg?raw";
import historyFill from "@material-symbols/svg-400/rounded/history-fill.svg?raw";
import home from "@material-symbols/svg-400/rounded/home.svg?raw";
import homeFill from "@material-symbols/svg-400/rounded/home-fill.svg?raw";
import info from "@material-symbols/svg-400/rounded/info.svg?raw";
import key from "@material-symbols/svg-400/rounded/key.svg?raw";
import lightMode from "@material-symbols/svg-400/rounded/light_mode.svg?raw";
import link from "@material-symbols/svg-400/rounded/link.svg?raw";
import logout from "@material-symbols/svg-400/rounded/logout.svg?raw";
import moreVert from "@material-symbols/svg-400/rounded/more_vert.svg?raw";
import personAdd from "@material-symbols/svg-400/rounded/person_add.svg?raw";
import powerSettings from "@material-symbols/svg-400/rounded/power_settings_new.svg?raw";
import refresh from "@material-symbols/svg-400/rounded/refresh.svg?raw";
import router from "@material-symbols/svg-400/rounded/router.svg?raw";
import share from "@material-symbols/svg-400/rounded/share.svg?raw";
import shareFill from "@material-symbols/svg-400/rounded/share-fill.svg?raw";
import toggleOn from "@material-symbols/svg-400/rounded/toggle_on.svg?raw";
import translate from "@material-symbols/svg-400/rounded/translate.svg?raw";
import warning from "@material-symbols/svg-400/rounded/warning.svg?raw";

export const ICONS = {
  add,
  admin: adminPanel,
  "arrow-back": arrowBack,
  "arrow-drop-down": arrowDropDown,
  account: accountCircle,
  "account-fill": accountCircleFill,
  check,
  close,
  computer,
  copy: contentCopy,
  "dark-mode": darkMode,
  delete: deleteIcon,
  devices,
  dns,
  edit,
  group,
  "group-fill": groupFill,
  history,
  "history-fill": historyFill,
  home,
  "home-fill": homeFill,
  info,
  key,
  "light-mode": lightMode,
  link,
  logout,
  more: moreVert,
  "person-add": personAdd,
  power: powerSettings,
  refresh,
  router,
  share,
  "share-fill": shareFill,
  toggle: toggleOn,
  translate,
  warning,
} as const;

export type IconName = keyof typeof ICONS;
