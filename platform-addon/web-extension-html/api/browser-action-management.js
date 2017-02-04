Cu.import("resource://gre/modules/ExtensionUtils.jsm");

var {
  SingletonEventManager
} = ExtensionUtils;

extensions.registerSchemaAPI("browserActionManagement", "addon_parent", context => {
  let {extension} = context;
  return { browserActionManagement : {
    click(actionId) {
      extensions.emit("browser_action_click", actionId);
    },

    getAll() {
      return new Promise(done => {
        let listener = (all, b) => {
          extensions.off("browser_action_all", listener);
          done(b);
        };
        extensions.on("browser_action_all", listener);
        extensions.emit("browser_action_getAll");
      });
    },

    onUpdate: new SingletonEventManager(context, "browserActionManagement.onUpdate", fire => {
      let listener = (_, event, data) => {
        fire.async(event, data);
      };
      extensions.on("browser_action_event", listener);
      return () => {
        extensions.off("browser_action_event", listener);
      };
    }).api()
  }};
});
