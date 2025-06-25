const path = require("path");

module.exports = {
  extends: ["../../.eslintrc.json","plugin:eslint-seatbelt/enable-legacy"],
  plugins: ["eslint-seatbelt"],
  parserOptions: {
    project: [path.resolve(__dirname, "./tsconfig.json")],
  },
};
