// payment.js
import { DataTypes, UUIDV4 } from 'sequelize';
import sequelize from '../db';

const Payment = sequelize.define('Payment', {
  id: {
    type: DataTypes.UUID,
    defaultValue: UUIDV4,
    primaryKey: true,
    allowNull: false
  },
  paymentId: {
    type: DataTypes.STRING,
    allowNull: true
  },
  dateCreated: {
    type: DataTypes.DATE,
    allowNull: true
  },
  items: {
    type: DataTypes.JSONB,
    allowNull: true
  },
  status: {
      type: DataTypes.STRING,
    allowNull: true
  },
  transaction_amount: {
      type: DataTypes.INTEGER,
    allowNull: true
  },
  payer: {
    type: DataTypes.JSONB,
    allowNull: true
  },
  shipments: {
    type: DataTypes.JSONB,
    allowNull: true
  }
});

export default Payment;
