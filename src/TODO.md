以后或许可以统一的 practice-session-cache-manager-hook 中，我们就可以在一个地方优雅地处理这种复杂的依赖关系。
这个统一的钩子会监听所有相关的集合。
然后，在事件处理函数中，我们可以精确地控制所有相关缓存的更新：


现在practice_sessions.items.create触发的东西太多了。
我在创建试卷的时候，会触发practice_sessions.items.create，导致会频繁地触发缓存更新。这个后面一定要改。