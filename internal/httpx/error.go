package httpx

import "github.com/gin-gonic/gin"

// Error menulis format error standar Dispatch:
// {"error":{"code":"...","message":"..."}}
func Error(c *gin.Context, status int, code, message string) {
	c.AbortWithStatusJSON(status, gin.H{
		"error": gin.H{
			"code":    code,
			"message": message,
		},
	})
}
