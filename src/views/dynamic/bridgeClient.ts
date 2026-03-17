/**
 * Bridge client script injected into sandboxed iframes.
 *
 * Defines `window.s2b` with async methods that communicate with the
 * parent plugin via `postMessage`.
 *
 * This string is injected as an inline `<script>` before user code.
 */

export const BRIDGE_CLIENT_SCRIPT = `
<script>
(function() {
  "use strict";
  var _id = 0;
  var _pending = {};

  window.addEventListener("message", function(e) {
    var d = e.data;
    if (!d || d.type !== "s2b-bridge-response") return;
    var cb = _pending[d.id];
    if (!cb) return;
    delete _pending[d.id];
    if (d.error) cb.reject(new Error(d.error));
    else cb.resolve(d.result);
  });

  function call(method, args) {
    return new Promise(function(resolve, reject) {
      var id = "req_" + (++_id);
      _pending[id] = { resolve: resolve, reject: reject };
      parent.postMessage({ type: "s2b-bridge", id: id, method: method, args: args || [] }, "*");
    });
  }

  window.s2b = {
    searchNotes: function(query, limit) { return call("searchNotes", [query, limit]); },
    readContent: function(path) { return call("readContent", [path]); },
    getProperties: function(path) { return call("getProperties", [path]); },
    getAllTags: function() { return call("getAllTags", []); },
    listFiles: function(prefix) { return call("listFiles", [prefix]); },
    createNote: function(path, content) { return call("createNote", [path, content]); },
    updateNote: function(path, content) { return call("updateNote", [path, content]); },
    deleteNote: function(path) { return call("deleteNote", [path]); }
  };
})();
</script>`;
