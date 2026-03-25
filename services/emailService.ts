import nodemailer from 'nodemailer';

// Создаем транспорт для отправки email
const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 465,
  secure: true, // true для 465, false для других портов
  auth: {
    user: process.env.EMAIL_USER || 'your-email@gmail.com',
    pass: process.env.EMAIL_PASS || 'your-app-password'
  }
});

// Проверяем соединение при старте
// Временно отключено для отладки
// transporter.verify((error, success) => {
//   if (error) {
//     console.error('Email transporter error:', error);
//   } else {
//     console.log('Email server is ready to send messages');
//   }
// });

// Генерация 6-значного кода
export const generateVerificationCode = (): string => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

// Отправка кода верификации
export const sendVerificationCode = async (email: string, code: string): Promise<void> => {
  try {
    const mailOptions = {
      from: process.env.EMAIL_USER || 'noreply@loopera.com',
      to: email,
      subject: 'Код верификации Loopera',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="text-align: center; margin-bottom: 30px;">
            <h1 style="color: #ff2a55; margin: 0;">Loopera</h1>
            <p style="color: #666; margin: 5px 0;">Код верификации</p>
          </div>
          
          <div style="background: #f8f9fa; padding: 30px; border-radius: 10px; text-align: center; margin: 20px 0;">
            <h2 style="color: #333; margin: 0 0 10px 0;">Ваш код верификации:</h2>
            <div style="font-size: 32px; font-weight: bold; color: #ff2a55; letter-spacing: 8px; margin: 20px 0;">
              ${code}
            </div>
            <p style="color: #666; margin: 10px 0 0 0;">Введите этот код на странице регистрации</p>
          </div>
          
          <div style="text-align: center; color: #999; font-size: 14px; margin-top: 30px;">
            <p>Этот код истечет через 10 минут</p>
            <p>Если вы не запрашивали код, проигнорируйте это письмо</p>
          </div>
        </div>
      `
    };

    await transporter.sendMail(mailOptions);
    console.log('Verification code sent to:', email);
  } catch (error) {
    console.error('Error sending verification code:', error);
    throw new Error('Ошибка отправки кода верификации');
  }
};
