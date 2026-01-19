const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const mysql = require('mysql2');
const { OAuth2Client } = require('google-auth-library'); // Thêm dòng này

// Thay CLIENT_ID bằng mã bạn lấy ở Bước 1
const GOOGLE_CLIENT_ID =
  '450459843736-8m4qler3o66cgpa5heh4rls3177jii61.apps.googleusercontent.com';
const client = new OAuth2Client(GOOGLE_CLIENT_ID);

const app = express();
const PORT = 5000;

// Middleware
app.use(cors());

// --- SỬA LỖI 413 PAYLOAD TOO LARGE ---
// Tăng giới hạn dung lượng request lên 50MB để nhận được ảnh Base64
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));

// 1. Cấu hình kết nối MySQL
const db = mysql.createConnection({
  host: 'localhost',
  port: 3307, // Port MySQL của bạn
  user: 'root',
  password: 'root',
  database: 'bakery_shop',
});

// Kết nối database
db.connect((err) => {
  if (err) {
    console.error('Lỗi kết nối MySQL:', err);
    return;
  }
  console.log('Đã kết nối thành công tới MySQL Database trên port 3307');
});

// =======================================================
// API SẢN PHẨM (PUBLIC & ADMIN)
// =======================================================

// 1. Lấy danh sách sản phẩm (Có phân trang, lọc, sắp xếp)
app.get('/api/products', (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 8;
  const category = req.query.category || 'Tất cả';
  const sort = req.query.sort || 'newest';

  const offset = (page - 1) * limit;

  let sqlData = 'SELECT * FROM products';
  let sqlCount = 'SELECT COUNT(*) as total FROM products';
  let params = [];
  let countParams = [];

  // Filter
  if (category !== 'Tất cả') {
    sqlData += ' WHERE category = ?';
    sqlCount += ' WHERE category = ?';
    params.push(category);
    countParams.push(category);
  }

  // Sort
  if (sort === 'price-asc') {
    sqlData += ' ORDER BY price ASC';
  } else if (sort === 'price-desc') {
    sqlData += ' ORDER BY price DESC';
  } else {
    sqlData += ' ORDER BY id DESC'; // Newest
  }

  // Pagination
  sqlData += ' LIMIT ? OFFSET ?';
  params.push(limit, offset);

  // Execute
  db.query(sqlCount, countParams, (err, countResult) => {
    if (err) return res.status(500).json({ error: err.message });

    const total = countResult[0].total;
    const totalPages = Math.ceil(total / limit);

    db.query(sqlData, params, (err, products) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({
        data: products,
        pagination: { page, limit, total, totalPages },
      });
    });
  });
});

// 2. Lấy chi tiết 1 sản phẩm
app.get('/api/products/:id', (req, res) => {
  const sql = 'SELECT * FROM products WHERE id = ?';
  db.query(sql, [req.params.id], (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    if (results.length === 0)
      return res.status(404).json({ message: 'Không tìm thấy bánh' });
    res.json(results[0]);
  });
});

// 3. Thêm sản phẩm mới (Admin) - Đã fix lỗi trùng SKU
app.post('/api/admin/products', (req, res) => {
  let {
    name,
    category,
    price,
    image,
    description,
    sku,
    stock_quantity,
    is_active,
  } = req.body;

  // Tự sinh SKU nếu rỗng
  if (!sku || sku.trim() === '') {
    sku = 'SKU-' + Date.now().toString().slice(-6);
  }

  const sql =
    'INSERT INTO products (name, category, price, image, description, sku, stock_quantity, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?)';
  db.query(
    sql,
    [
      name,
      category,
      price,
      image,
      description,
      sku,
      stock_quantity || 0,
      is_active !== undefined ? is_active : true,
    ],
    (err, result) => {
      if (err) {
        console.error('Lỗi thêm sản phẩm:', err);
        return res.status(500).json({ error: err.message });
      }
      res.status(201).json({
        success: true,
        message: 'Thêm sản phẩm thành công',
        id: result.insertId,
      });
    }
  );
});

// 4. Cập nhật sản phẩm (Admin)
app.put('/api/admin/products/:id', (req, res) => {
  const {
    name,
    category,
    price,
    image,
    description,
    sku,
    stock_quantity,
    is_active,
  } = req.body;
  const sql =
    'UPDATE products SET name=?, category=?, price=?, image=?, description=?, sku=?, stock_quantity=?, is_active=? WHERE id=?';
  db.query(
    sql,
    [
      name,
      category,
      price,
      image,
      description,
      sku,
      stock_quantity,
      is_active,
      req.params.id,
    ],
    (err, result) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true, message: 'Cập nhật thành công' });
    }
  );
});

// 5. Xóa sản phẩm (Admin)
app.delete('/api/admin/products/:id', (req, res) => {
  const sql = 'DELETE FROM products WHERE id = ?';
  db.query(sql, [req.params.id], (err, result) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true, message: 'Xóa sản phẩm thành công' });
  });
});

// =======================================================
// API ĐƠN HÀNG (ORDER)
// =======================================================

// 1. Tạo đơn hàng mới
app.post('/api/orders', (req, res) => {
  const { customerInfo, cartItems, total, userId } = req.body;

  const orderSql =
    'INSERT INTO orders (customer_name, customer_phone, customer_address, total_price, user_id) VALUES (?, ?, ?, ?, ?)';
  db.query(
    orderSql,
    [
      customerInfo.name,
      customerInfo.phone,
      customerInfo.address,
      total,
      userId || null,
    ],
    (err, result) => {
      if (err) return res.status(500).json({ error: err.message });

      const orderId = result.insertId;
      const itemSql =
        'INSERT INTO order_items (order_id, product_id, product_name, quantity, price) VALUES ?';
      const values = cartItems.map((item) => [
        orderId,
        item.id,
        item.name,
        item.quantity,
        item.price,
      ]);

      db.query(itemSql, [values], (err, result) => {
        if (err)
          return res.status(500).json({ error: 'Lỗi lưu chi tiết đơn hàng' });
        res.status(201).json({
          success: true,
          message: 'Đặt hàng thành công',
          orderId: orderId,
        });
      });
    }
  );
});

// 2. Lấy lịch sử đơn hàng của User
app.get('/api/orders/user/:userId', (req, res) => {
  const userId = req.params.userId;
  const sql = 'SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC';
  db.query(sql, [userId], (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(results);
  });
});

// 3. Quản lý đơn hàng (Admin) - Có phân trang & Lọc
app.get('/api/admin/orders', (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const status = req.query.status || 'Tất cả';
  const offset = (page - 1) * limit;

  let countSql = 'SELECT COUNT(*) as total FROM orders';
  let dataSql = 'SELECT * FROM orders';
  let params = [];

  if (status !== 'Tất cả') {
    countSql += ' WHERE status = ?';
    dataSql += ' WHERE status = ?';
    params.push(status);
  }

  dataSql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  const dataParams = [...params, limit, offset];

  db.query(countSql, params, (err, countRes) => {
    if (err) return res.status(500).json({ error: err.message });
    const total = countRes[0].total;
    const totalPages = Math.ceil(total / limit);

    db.query(dataSql, dataParams, (err, results) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({
        data: results,
        pagination: { page, limit, total, totalPages },
      });
    });
  });
});

// 4. Cập nhật trạng thái đơn hàng (Admin) + Trừ kho
app.put('/api/admin/orders/:id/status', (req, res) => {
  const { status } = req.body;
  const orderId = req.params.id;

  // Logic trừ kho khi hoàn thành
  if (status === 'Completed') {
    const getItemsSql =
      'SELECT product_id, quantity FROM order_items WHERE order_id = ?';
    db.query(getItemsSql, [orderId], (err, items) => {
      if (err) return res.status(500).json({ error: 'Lỗi lấy chi tiết đơn' });

      items.forEach((item) => {
        const updateStockSql =
          'UPDATE products SET stock_quantity = GREATEST(0, stock_quantity - ?) WHERE id = ?';
        db.query(updateStockSql, [item.quantity, item.product_id]);
      });

      // Sau khi trừ kho thì update trạng thái
      const sql = 'UPDATE orders SET status = ? WHERE id = ?';
      db.query(sql, [status, orderId], (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({
          success: true,
          message: 'Đã hoàn thành đơn hàng và trừ kho',
        });
      });
    });
  } else {
    const sql = 'UPDATE orders SET status = ? WHERE id = ?';
    db.query(sql, [status, orderId], (err, result) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true, message: 'Cập nhật trạng thái thành công' });
    });
  }
});

// =======================================================
// API KHÁCH HÀNG & AUTH
// =======================================================

// 1. Đăng ký
app.post('/api/register', (req, res) => {
  const { fullName, email, password } = req.body;
  const checkSql = 'SELECT * FROM users WHERE email = ?';
  db.query(checkSql, [email], (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    if (results.length > 0)
      return res
        .status(400)
        .json({ success: false, message: 'Email này đã được sử dụng' });

    const insertSql =
      'INSERT INTO users (full_name, email, password) VALUES (?, ?, ?)';
    db.query(insertSql, [fullName, email, password], (err, result) => {
      if (err) return res.status(500).json({ error: err.message });
      res.status(201).json({ success: true, message: 'Đăng ký thành công' });
    });
  });
});

// 2. Đăng nhập
app.post('/api/login', (req, res) => {
  const { email, password } = req.body;
  const sql = 'SELECT * FROM users WHERE email = ? AND password = ?';
  db.query(sql, [email, password], (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    if (results.length > 0) {
      const user = results[0];

      // Kiểm tra trạng thái khóa
      if (user.status === 'locked') {
        return res
          .status(403)
          .json({ success: false, message: 'Tài khoản của bạn đã bị khóa' });
      }

      const { password, ...userInfo } = user;
      res.json({
        success: true,
        message: 'Đăng nhập thành công',
        user: userInfo,
      });
    } else {
      res
        .status(401)
        .json({ success: false, message: 'Email hoặc mật khẩu không đúng' });
    }
  });
});

// 3. Cập nhật thông tin User
app.put('/api/users/:id', (req, res) => {
  const userId = req.params.id;
  const { full_name, phone, address, password } = req.body;
  let sql = 'UPDATE users SET full_name = ?, phone = ?, address = ?';
  let params = [full_name, phone, address];
  if (password) {
    sql += ', password = ?';
    params.push(password);
  }
  sql += ' WHERE id = ?';
  params.push(userId);
  db.query(sql, params, (err, result) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true, message: 'Cập nhật thông tin thành công' });
  });
});

// 4. Lấy danh sách khách hàng (Admin)
app.get('/api/admin/customers', (req, res) => {
  const sql = `
        SELECT u.id, u.full_name, u.email, u.phone, u.status, u.created_at,
        COALESCE(SUM(o.total_price), 0) as total_spent
        FROM users u
        LEFT JOIN orders o ON u.id = o.user_id
        WHERE u.role = 'customer'
        GROUP BY u.id
        ORDER BY u.created_at DESC
    `;
  db.query(sql, (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(results);
  });
});

// 5. Cập nhật trạng thái khách hàng (Admin)
app.put('/api/admin/customers/:id/status', (req, res) => {
  const { status } = req.body;
  const sql = 'UPDATE users SET status = ? WHERE id = ?';
  db.query(sql, [status, req.params.id], (err, result) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true, message: 'Cập nhật trạng thái thành công' });
  });
});

// =======================================================
// API THỐNG KÊ (DASHBOARD)
// =======================================================
app.get('/api/admin/stats', (req, res) => {
  const queries = {
    revenue:
      "SELECT SUM(total_price) as total FROM orders WHERE status != 'Cancelled'",
    orders: 'SELECT COUNT(*) as count FROM orders',
    customers: "SELECT COUNT(*) as count FROM users WHERE role = 'customer'",
    topProducts: `
            SELECT p.name, SUM(oi.quantity) as sold 
            FROM order_items oi 
            JOIN products p ON oi.product_id = p.id 
            GROUP BY p.id ORDER BY sold DESC LIMIT 5
        `,
  };

  db.query(queries.revenue, (err, revRes) => {
    if (err) return res.status(500).json({ error: err });
    db.query(queries.orders, (err, ordRes) => {
      db.query(queries.customers, (err, cusRes) => {
        db.query(queries.topProducts, (err, topRes) => {
          res.json({
            revenue: revRes[0].total || 0,
            totalOrders: ordRes[0].count || 0,
            totalCustomers: cusRes[0].count || 0,
            topProducts: topRes,
          });
        });
      });
    });
  });
});

// API MỚI: Lấy chi tiết đơn hàng
app.get('/api/admin/orders/:id', (req, res) => {
  const orderId = req.params.id;

  // 1. Lấy thông tin chung đơn hàng
  const sqlOrder = 'SELECT * FROM orders WHERE id = ?';

  // 2. Lấy danh sách món trong đơn (Join thêm bảng products để lấy ảnh)
  const sqlItems = `
        SELECT oi.*, p.image, p.sku 
        FROM order_items oi 
        LEFT JOIN products p ON oi.product_id = p.id 
        WHERE oi.order_id = ?
    `;

  db.query(sqlOrder, [orderId], (err, orderResult) => {
    if (err) return res.status(500).json({ error: err.message });
    if (orderResult.length === 0)
      return res.status(404).json({ message: 'Không tìm thấy đơn hàng' });

    const order = orderResult[0];

    db.query(sqlItems, [orderId], (err, itemsResult) => {
      if (err) return res.status(500).json({ error: err.message });

      // Trả về object đơn hàng có kèm mảng items
      res.json({ ...order, items: itemsResult });
    });
  });
});

// --- API LOGIN GOOGLE (MỚI) ---
app.post('/api/auth/google', async (req, res) => {
  const { token } = req.body;

  try {
    // 1. Xác thực token với Google Server
    const ticket = await client.verifyIdToken({
      idToken: token,
      audience: GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();

    const { email, name, picture, sub } = payload; // sub là google_id

    // 2. Kiểm tra xem user đã tồn tại chưa
    const checkSql = 'SELECT * FROM users WHERE email = ?';
    db.query(checkSql, [email], (err, results) => {
      if (err) return res.status(500).json({ error: err.message });

      if (results.length > 0) {
        // User đã tồn tại -> Đăng nhập
        const user = results[0];

        // Nếu tài khoản bị khóa
        if (user.status === 'locked') {
          return res
            .status(403)
            .json({ success: false, message: 'Tài khoản bị khóa' });
        }

        // Cập nhật avatar nếu chưa có
        if (!user.avatar) {
          db.query('UPDATE users SET avatar = ? WHERE id = ?', [
            picture,
            user.id,
          ]);
        }

        const { password, ...userInfo } = user;
        res.json({
          success: true,
          message: 'Đăng nhập Google thành công',
          user: userInfo,
        });
      } else {
        // User chưa tồn tại -> Tạo mới (Password để null)
        const insertSql =
          'INSERT INTO users (full_name, email, google_id, avatar, password) VALUES (?, ?, ?, ?, NULL)';
        db.query(insertSql, [name, email, sub, picture], (err, result) => {
          if (err) return res.status(500).json({ error: err.message });

          const newUser = {
            id: result.insertId,
            full_name: name,
            email: email,
            avatar: picture,
            role: 'customer',
            status: 'active',
          };
          res.json({
            success: true,
            message: 'Đăng ký Google thành công',
            user: newUser,
          });
        });
      }
    });
  } catch (error) {
    console.error(error);
    res
      .status(401)
      .json({ success: false, message: 'Token Google không hợp lệ' });
  }
});

// Khởi chạy server
app.listen(PORT, () => {
  console.log(`Server đang chạy tại http://localhost:${PORT}`);
});
