const pool = require("../config/dbConfig");

const createUser = async (user) => {
  const query = `
      INSERT INTO users (firstname, lastname, username, email, password, role_id, company_id, is_active, is_verified)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *;
  `;
  const values = [
    user.firstname,
    user.lastname,
    user.username,
    user.email,
    user.passwordHash,
    user.roleId,
    user.companyId,
    user.isActive,
    user.isVerified,
  ];
  const result = await pool.query(query, values);
  return result.rows[0];
};

const findUserByEmail = async (email) => {
  const query = "SELECT * FROM users WHERE email = $1";
  const result = await pool.query(query, [email]);
  return result.rows[0];
};

const updateUserPasswordById = async (id, passwordHash) => {
  const query = "UPDATE users SET password = $1 WHERE id = $2 RETURNING *";
  const result = await pool.query(query, [passwordHash, id]);
  return result.rows[0];
};

module.exports = {
  createUser,
  findUserByEmail,
  updateUserPasswordById,
};