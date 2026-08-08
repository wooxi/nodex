# luci-app-nodex：LuCI 前端界面（配合 nodex daemon 包使用）
include $(TOPDIR)/rules.mk

PKG_NAME:=luci-app-nodex
PKG_VERSION:=0.2.0
PKG_RELEASE:=1

PKG_BUILD_DIR:=$(BUILD_DIR)/$(PKG_NAME)-$(PKG_VERSION)

include $(INCLUDE_DIR)/package.mk

define Package/luci-app-nodex
  SECTION:=luci
  CATEGORY:=LuCI
  SUBMENU:=3. Applications
  TITLE:=NodeX - OpenWrt node manager UI
  DEPENDS:=+luci-base +nodex
  PKGARCH:=all
endef

define Package/luci-app-nodex/description
  NodeX LuCI 界面：集成到路由器「服务」菜单，管理 Xray/Hysteria2 节点与 Xboard 面板对接。
  后端由 nodex 守护进程提供（监听 127.0.0.1，LuCI 通过代理访问）。
endef

define Build/Compile
	$(INSTALL_DIR) $(PKG_BUILD_DIR)
endef

define Package/luci-app-nodex/install
	$(INSTALL_DIR) $(1)/usr/lib/lua/luci/controller
	$(INSTALL_DATA) ./luasrc/controller/nodex.lua $(1)/usr/lib/lua/luci/controller/
	$(INSTALL_DIR) $(1)/usr/share/luci/menu.d
	$(INSTALL_DATA) ./luasrc/menu.d/luci-app-nodex.json $(1)/usr/share/luci/menu.d/
	$(INSTALL_DIR) $(1)/www/luci-static/resources/view/nodex
	$(INSTALL_DATA) ./luasrc/view/nodex/*.js $(1)/www/luci-static/resources/view/nodex/
endef

$(eval $(call BuildPackage,luci-app-nodex))
