// 脚本文件，非模块：顶层 interface Window 直接合并进全局作用域；一旦出现 import/export，合并即失效。
interface Window {
  __ROOT_MOUNTED__?: boolean;
  __PREBOOT_ERROR__?: string | null;
}
