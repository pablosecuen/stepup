// Define el modelo de Sequelize para la tabla de envíos
import { DataTypes } from 'sequelize';
import sequelize from '../db';

const Envio = sequelize.define('Envio', {
    productos: {
        type: DataTypes.JSONB,
        allowNull: true
    },
    autentificacion: {
        type: DataTypes.JSONB,
        allowNull: true
    },
    destinatario: {
        type: DataTypes.JSONB,
        allowNull: true
    },
    autorizado: {
        type: DataTypes.JSONB,
        allowNull: true
    },
    domicilio: {
        type: DataTypes.JSONB,
        allowNull: true
    },
    datoNumerico: {
        type: DataTypes.STRING,
        allowNull: true
    },
   codigoSeguimiento: {
    type: DataTypes.INTEGER, 
    allowNull: true,
    autoIncrement: true, 
    primaryKey: true 
},
    codigoAlternativo: {
        type: DataTypes.INTEGER,
        allowNull: true
    },
    modeloSms: {
        type: DataTypes.STRING,
        allowNull: true
    },
    modeloEmail: {
        type: DataTypes.STRING,
        allowNull: true
    },
    servicio: {
        type: DataTypes.STRING,
        allowNull: true
    },
    marcaDeAgua: {
        type: DataTypes.STRING,
        allowNull: true
    },
    observaciones: {
        type: DataTypes.JSONB,
        allowNull: true
    }
});

export default Envio;
