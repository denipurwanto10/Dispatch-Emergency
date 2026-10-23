package repository

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"dispatch/internal/model"
)

var ErrNotFound = errors.New("data tidak ditemukan")

type UserRepository struct {
	db *sql.DB
}

func NewUserRepository(db *sql.DB) *UserRepository {
	return &UserRepository{db: db}
}

func (r *UserRepository) DB() *sql.DB {
	return r.db
}

func scanUser(row interface {
	Scan(dest ...any) error
}) (model.User, error) {
	var (
		user          model.User
		operatingCity sql.NullString
	)
	if err := row.Scan(&user.ID, &user.Email, &user.Role, &user.Name,
		&operatingCity, &user.CreatedAt); err != nil {
		return model.User{}, err
	}
	if operatingCity.Valid {
		user.OperatingCity = &operatingCity.String
	}
	return user, nil
}

const userColumns = `id, email, role, name, operating_city, created_at`

func (r *UserRepository) GetByID(ctx context.Context, id int64) (model.User, error) {
	user, err := scanUser(r.db.QueryRowContext(ctx, `
		SELECT `+userColumns+`
		FROM users
		WHERE id = $1`, id))
	if errors.Is(err, sql.ErrNoRows) {
		return model.User{}, ErrNotFound
	}
	if err != nil {
		return model.User{}, fmt.Errorf("ambil user: %w", err)
	}
	return user, nil
}

type CreateUserParams struct {
	Email         string
	PasswordHash  string
	Role          string
	Name          string
	OperatingCity *string
}

func (r *UserRepository) Create(ctx context.Context, params CreateUserParams) (model.User, error) {
	user, err := scanUser(r.db.QueryRowContext(ctx, `
		INSERT INTO users (email, password_hash, role, name, operating_city)
		VALUES ($1, $2, $3, $4, $5)
		RETURNING `+userColumns,
		params.Email, params.PasswordHash, params.Role, params.Name, params.OperatingCity))
	if err != nil {
		return model.User{}, fmt.Errorf("buat user: %w", err)
	}
	return user, nil
}

type UpdateUserParams struct {
	Name          string
	Role          string
	OperatingCity *string
	PasswordHash  *string
}

func (r *UserRepository) Update(ctx context.Context, id int64, params UpdateUserParams) (model.User, error) {
	query := `
		UPDATE users
		SET name = $2, role = $3, operating_city = $4`
	args := []any{id, params.Name, params.Role, params.OperatingCity}
	if params.PasswordHash != nil {
		query += `, password_hash = $5`
		args = append(args, *params.PasswordHash)
	}
	query += `
		WHERE id = $1
		RETURNING ` + userColumns

	user, err := scanUser(r.db.QueryRowContext(ctx, query, args...))
	if errors.Is(err, sql.ErrNoRows) {
		return model.User{}, ErrNotFound
	}
	if err != nil {
		return model.User{}, fmt.Errorf("ubah user: %w", err)
	}
	return user, nil
}

func (r *UserRepository) Delete(ctx context.Context, id int64) error {
	res, err := r.db.ExecContext(ctx, `DELETE FROM users WHERE id = $1`, id)
	if err != nil {
		return fmt.Errorf("hapus user: %w", err)
	}
	affected, _ := res.RowsAffected()
	if affected == 0 {
		return ErrNotFound
	}
	return nil
}

func (r *UserRepository) CountAdmins(ctx context.Context) (int, error) {
	var count int
	if err := r.db.QueryRowContext(ctx,
		`SELECT count(*) FROM users WHERE role = 'admin'`).Scan(&count); err != nil {
		return 0, fmt.Errorf("hitung admin: %w", err)
	}
	return count, nil
}

func (r *UserRepository) CountVehiclesForDriver(ctx context.Context, driverID int64) (int, error) {
	var count int
	if err := r.db.QueryRowContext(ctx,
		`SELECT count(*) FROM vehicles WHERE driver_id = $1`, driverID).Scan(&count); err != nil {
		return 0, fmt.Errorf("hitung kendaraan driver: %w", err)
	}
	return count, nil
}

func (r *UserRepository) CountActiveAssignmentsForDriver(ctx context.Context, driverID int64) (int, error) {
	var count int
	if err := r.db.QueryRowContext(ctx, `
		SELECT count(*)
		FROM assignments a
		JOIN vehicles v ON v.id = a.vehicle_id
		WHERE v.driver_id = $1
		  AND a.status IN ('assigned', 'en_route', 'arrived')`, driverID).Scan(&count); err != nil {
		return 0, fmt.Errorf("hitung assignment aktif driver: %w", err)
	}
	return count, nil
}

func (r *UserRepository) FindByEmail(ctx context.Context, email string) (model.User, error) {
	var (
		user          model.User
		operatingCity sql.NullString
	)
	err := r.db.QueryRowContext(ctx, `
		SELECT id, email, password_hash, role, name, operating_city, created_at
		FROM users
		WHERE email = $1`, email,
	).Scan(&user.ID, &user.Email, &user.PasswordHash, &user.Role, &user.Name,
		&operatingCity, &user.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return model.User{}, ErrNotFound
	}
	if err != nil {
		return model.User{}, fmt.Errorf("cari user berdasarkan email: %w", err)
	}
	if operatingCity.Valid {
		user.OperatingCity = &operatingCity.String
	}
	return user, nil
}

// List tanpa password_hash — kolom itu tidak pernah ikut di-query.
func (r *UserRepository) List(ctx context.Context) ([]model.User, error) {
	rows, err := r.db.QueryContext(ctx, `
		SELECT id, email, role, name, operating_city, created_at
		FROM users
		ORDER BY id`)
	if err != nil {
		return nil, fmt.Errorf("daftar user: %w", err)
	}
	defer rows.Close()

	users := make([]model.User, 0)
	for rows.Next() {
		var (
			user          model.User
			operatingCity sql.NullString
		)
		if err := rows.Scan(&user.ID, &user.Email, &user.Role, &user.Name,
			&operatingCity, &user.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan user: %w", err)
		}
		if operatingCity.Valid {
			user.OperatingCity = &operatingCity.String
		}
		users = append(users, user)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterasi user: %w", err)
	}
	return users, nil
}
