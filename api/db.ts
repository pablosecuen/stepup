import { Sequelize } from 'sequelize';
import dotenv from 'dotenv';

dotenv.config();

let sequelize: Sequelize;

if (process.env.DATABASE_URL) {
  sequelize = new Sequelize(process.env.DATABASE_URL, {
    dialect: "postgres",
    logging: false
  });
} else {
  sequelize = new Sequelize({
    dialect: "postgres",
    username: process.env.DATABASE_USERNAME,
    password: process.env.DATABASE_PASSWORD,
    database: process.env.DATABASE_NAME,
    host: "localhost",
    port: 5432, // Puerto predeterminado de PostgreSQL
    logging: false
  });
}

// Sincronizar modelos con la base de datos y crear la base de datos si no existe
sequelize.sync({ force: true })
  .then(() => {
    console.log('Modelos sincronizados correctamente con la base de datos.');
  })
  .catch((error) => {
    console.error('Error al sincronizar modelos con la base de datos:', error);
  });

export default sequelize;
