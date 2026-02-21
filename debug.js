const http = require("http");

http.get("http://localhost:3020/api/sessions", (res) => {
  let data = "";
  res.on("data", (chunk) => (data += chunk));
  res.on("end", () => {
    const match = data.match(
      /<script id="__NEXT_DATA__" type="application\/json">([\s\S]+?)<\/script>/,
    );
    if (match) {
      try {
        const p = JSON.parse(match[1]);
        if (p.err)
          console.log("Error details:", JSON.stringify(p.err, null, 2));
        else
          console.log(
            "No err in props, dumping full props:",
            JSON.stringify(p.props, null, 2),
          );
      } catch (e) {
        console.error("json parse error");
      }
    } else {
      console.log("No __NEXT_DATA__ found");
    }
  });
});
