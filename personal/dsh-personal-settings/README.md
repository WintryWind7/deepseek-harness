# 个人设置

设置栏里「个人」这一节的外壳。官方的设置面板只有一级导航，所以这里自己提供第二级：竖排的插件列表，点进去整个区域变成该插件的配置页，顶部是面包屑（点「个人」返回）。

外壳不读写任何设置，也不含具体配置页。自己的插件要加页面时，注册到 `personal.settings.page`：

```js
ctx.slots.inject('personal.settings.page', () => ctx.slots.register({
  name: 'personal.settings.page',
  id: 'my-page',
  order: 20,
  label: () => t('nav'),
  locale: 'my-page',
}, MyPage))
```

`order` 决定列表里的位置，`id` 是该页的唯一键。插件的 `package.json` 里把 `dsh-personal-settings` 写进 `dsh.client.inject`，让外壳的客户端条目先加载；`ctx.slots.inject` 会等槽位声明完成，加载顺序不影响注册。

页面自己控制内容，包括一段可选的置顶介绍：给介绍段落加 `ps-stickyTop` 类（粘在滚动区顶部，背景同设置面板）。外壳的样式类都以 `ps-` 开头，只在本插件内生效。

模型配置页见 `dsh-personal-settings-models`。
