const tftp = require('../../lib')
const fs = require('fs')

const client = tftp.createClient({
	host: "192.168.1.6",
	port: 69,
	bind: {
		port: 0,
		src: "192.168.1.100",
		callback: ()=>{}
	}
})

// const get = client.createGetStream("/Users/lj/tftp/fw-N300-96e-92f-gw.bin")
// const write = fs.createWriteStream("./test.log")
// get.pipe(write)
function getFileSize(filpath){
	const stat = fs.statSync(filpath)
	console.log(stat.size, stat.size / 1024)
	return stat.size
}
const localPath = "/Users/lj/tftpboot/fw-N300-96e-92f-gw.bin"
var read = fs.createReadStream (localPath);
var put = client.createPutStream ("img.tar", {size: getFileSize(localPath)});
read.pipe(put)

