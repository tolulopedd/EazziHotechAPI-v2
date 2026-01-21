const Pool = require("pg").Pool;

/*const pgDev = new Pool({
  user: "eazziadmin",
  host: "dpg-cpggoukf7o1s738eoet0-a",
  database: "eazzime_prd",
  password: "UTd8M4MSiwvOzOKtyNL2MegWu9AmDEbf",
  port: 5432,
});*/

const pgDev = new Pool({
  user: "postgres",
  host: "localhost",
  database: "eazzihotech_dev",
  password: "eazzime2024",
  port: 5432,
});

module.exports = pgDev;
