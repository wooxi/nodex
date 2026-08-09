# NodeX OpenWrt 包定义（SDK 编译用）
include $(TOPDIR)/rules.mk

PKG_NAME:=nodex
PKG_VERSION:=0.3.0
PKG_RELEASE:=1

PKG_BUILD_DIR:=$(BUILD_DIR)/$(PKG_NAME)-$(PKG_VERSION)

include $(INCLUDE_DIR)/package.mk

define Package/nodex
  SECTION:=net
  CATEGORY:=Network
  TITLE:=NodeX - Xray/Hysteria2 node manager with Xboard panel support
  URL:=https://github.com/wooxi/nodex
  DEPENDS:=+libc
endef

define Package/nodex/description
  NodeX 节点管家: 在 OpenWrt 上运行 Xray (vless/vmess/trojan/ss + Reality)
  与 Hysteria2 节点，通过 V2Board/Xboard 标准协议对接面板，
  自带 Web 表单化配置界面（默认端口 8888）。
  注意: 需自行安装 xray 与 hysteria 二进制 (opkg install xray hysteria 或手动放置)。
endef

# 二进制由 GitHub Actions 预编译，这里直接打包
define Build/Compile
	$(INSTALL_DIR) $(PKG_BUILD_DIR)
endef

define Package/nodex/install
	$(INSTALL_DIR) $(1)/usr/bin
	$(INSTALL_BIN) ./files/nodex $(1)/usr/bin/
	$(INSTALL_DIR) $(1)/etc/init.d
	$(INSTALL_BIN) ./files/etc/init.d/nodex $(1)/etc/init.d/
	$(INSTALL_DIR) $(1)/etc/nodex
	$(INSTALL_DATA) ./files/etc/nodex/config.json $(1)/etc/nodex/
endef

$(eval $(call BuildPackage,nodex))
